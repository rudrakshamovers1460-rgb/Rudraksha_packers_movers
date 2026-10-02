import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/order_model.dart';
import '../services/alert_manager.dart';
import '../services/api_service.dart';
import '../services/background_service.dart';
import '../services/location_service.dart';
import '../services/permission_service.dart';
import '../services/update_service.dart';
import '../widgets/order_alert_dialog.dart';
import 'login_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentTab = 0;
  Timer? _pollingTimer;

  bool _isLoading = false;
  OrderModel? _activeTrip;
  List<OrderModel> _availableJobs = [];
  final Set<String> _seenJobIds = {};
  final Set<String> _acknowledgedAssignedTrips = {};
  bool _isAlertDialogOpen = false;
  bool _isFirstSyncDone = false;

  // Earnings Data
  Map<String, dynamic>? _earningsData;

  // Controllers for in-line OTP inputs
  final TextEditingController _pickupOtpController = TextEditingController();
  final TextEditingController _deliveryOtpController = TextEditingController();
  bool _isVerifyingOtp = false;

  @override
  void initState() {
    super.initState();
    _loadInitialData();
    _startBackgroundPolling();

    // Start live GPS tracking and persistent foreground background service if On-Duty
    final isDuty = ApiService.currentDriver?.onDuty ?? true;
    if (isDuty) {
      LocationService().startTracking();
      BackgroundService.start();
    }

    // Listen to background service notifications and order events
    FlutterForegroundTask.addTaskDataCallback(_onReceiveBackgroundData);
    AlertManager.onActionCallback = (action, parcelId) {
      if (action == 'accept' && parcelId != null) {
        _handleNotificationAccept(parcelId);
      } else if (action == 'decline' && parcelId != null) {
        _handleNotificationDecline(parcelId);
      } else if (action == 'silent') {
        AlertManager().muteSound();
      }
    };

    WidgetsBinding.instance.addPostFrameCallback((_) {
      PermissionService.checkAndRequestAllPermissions(context);
      UpdateService.checkAndPromptUpdate(context);
    });
  }

  void _onReceiveBackgroundData(Object data) {
    if (data is Map<String, dynamic>) {
      final type = data['type'];
      if (type == 'new_order_alert' && data['order'] != null) {
        final order = OrderModel.fromJson(data['order'], isDirect: true);
        if (!_isAlertDialogOpen && !_acknowledgedAssignedTrips.contains(order.parcelId)) {
          _triggerOrderAlert(order);
        }
      }
    }
  }

  void _handleNotificationAccept(String parcelId) async {
    _acknowledgedAssignedTrips.add(parcelId);
    _isAlertDialogOpen = false;
    await AlertManager().stopAlert(notifId: parcelId.hashCode);
    final res = await ApiService.acceptJob(parcelId);
    if (res['success'] == true || res['already_accepted'] == true) {
      await _syncFeed();
      if (mounted) {
        setState(() => _currentTab = 1);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('🚀 Trip Ready! Head to the pickup location.'),
            backgroundColor: Color(0xFF22C55E),
          ),
        );
      }
    }
  }

  void _handleNotificationDecline(String parcelId) async {
    _acknowledgedAssignedTrips.add(parcelId);
    _isAlertDialogOpen = false;
    await AlertManager().stopAlert(notifId: parcelId.hashCode);

    // Save permanently in SharedPreferences
    final prefs = await SharedPreferences.getInstance();
    final declinedList = prefs.getStringList('rudraksha_driver_declined_parcels') ?? [];
    if (!declinedList.contains(parcelId)) {
      declinedList.add(parcelId);
      await prefs.setStringList('rudraksha_driver_declined_parcels', declinedList);
    }

    // Inform backend and admin
    await ApiService.declineJob(parcelId);
    await _syncFeed();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('❌ Order declined. Admin will reassign to another driver.'),
          backgroundColor: Color(0xFFEF4444),
        ),
      );
    }
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    LocationService().stopTracking();
    FlutterForegroundTask.removeTaskDataCallback(_onReceiveBackgroundData);
    AlertManager.onActionCallback = null;
    _pickupOtpController.dispose();
    _deliveryOtpController.dispose();
    super.dispose();
  }

  Future<void> _handleDutyToggle(bool val) async {
    await ApiService.toggleDuty(val);
    if (val) {
      LocationService().startTracking();
      BackgroundService.start();
    } else {
      LocationService().stopTracking();
      BackgroundService.stop();
    }
    if (mounted) {
      setState(() {});
      _syncFeed();
    }
  }

  void _loadInitialData() async {
    setState(() => _isLoading = true);
    await _syncFeed();
    await _loadEarnings();
    if (mounted) setState(() => _isLoading = false);
  }

  void _startBackgroundPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = Timer.periodic(const Duration(seconds: 5), (timer) {
      final isDuty = ApiService.currentDriver?.onDuty ?? true;
      if (isDuty) {
        _syncFeed();
      }
    });
  }

  Future<void> _syncFeed() async {
    final res = await ApiService.fetchFeed();
    if (!res['success'] || !mounted) return;

    final OrderModel? active = res['activeTrip'];
    final List<OrderModel> available = res['availableJobs'] ?? [];

    // 1. Direct Admin Assignment Detection
    // When an order is assigned by admin, bookingStatus will be 'driver_assigned' or 'received'.
    // ALWAYS alert with siren and popup if driver has not acknowledged or accepted it in this session.
    if (active != null) {
      final isAssigned = (active.bookingStatus == 'driver_assigned' ||
          active.bookingStatus == 'received');
      if (isAssigned && !_acknowledgedAssignedTrips.contains(active.parcelId)) {
        active.isDirectAssignment = true;
        if (!_isAlertDialogOpen) {
          _triggerOrderAlert(active);
        }
      }
    }

    // 2. Open Available Pool Jobs Detection
    final isDuty = ApiService.currentDriver?.onDuty ?? true;
    if (isDuty && active == null) {
      if (!_isFirstSyncDone) {
        for (var job in available) {
          _seenJobIds.add(job.parcelId);
        }
      } else {
        final newJobs =
            available.where((j) => !_seenJobIds.contains(j.parcelId)).toList();
        if (newJobs.isNotEmpty) {
          final latest = newJobs.first;
          for (var j in newJobs) {
            _seenJobIds.add(j.parcelId);
          }
          latest.isDirectAssignment = false;
          if (!_isAlertDialogOpen) {
            _triggerOrderAlert(latest);
          }
        }
      }
    } else {
      for (var j in available) {
        _seenJobIds.add(j.parcelId);
      }
    }

    _isFirstSyncDone = true;

    setState(() {
      _activeTrip = active;
      _availableJobs = available;
    });
  }

  Future<void> _loadEarnings() async {
    final data = await ApiService.fetchEarnings();
    if (mounted) {
      setState(() => _earningsData = data);
    }
  }

  void _triggerOrderAlert(OrderModel order) {
    if (_isAlertDialogOpen) return;
    _isAlertDialogOpen = true;

    AlertManager().triggerNewOrderAlert(order);

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => OrderAlertDialog(
        order: order,
        onDecline: () {
          _handleNotificationDecline(order.parcelId);
        },
        onAccept: () async {
          _acknowledgedAssignedTrips.add(order.parcelId);
          _isAlertDialogOpen = false;
          await AlertManager().stopAlert(notifId: order.parcelId.hashCode);

          if (order.isDirectAssignment) {
            _syncFeed();
            if (mounted) {
              setState(() => _currentTab = 1); // Switch to Active Trip
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('🚀 Trip Ready! Head to the pickup location.'),
                  backgroundColor: Color(0xFF22C55E),
                ),
              );
            }
          } else {
            final res = await ApiService.acceptJob(order.parcelId);
            if (res['success'] == true) {
              await _syncFeed();
              if (mounted) {
                setState(() => _currentTab = 1); // Switch to Active Trip
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('🎉 Order Accepted! Active trip updated.'),
                    backgroundColor: Color(0xFF22C55E),
                  ),
                );
              }
            } else {
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(res['error'] ?? 'Failed to accept order'),
                    backgroundColor: Colors.red,
                  ),
                );
              }
            }
          }
        },
      ),
    ).then((_) {
      _isAlertDialogOpen = false;
      AlertManager().stopAlert(notifId: order.parcelId.hashCode);
    });
  }

  // Google Maps Turn-by-Turn GPS Navigation
  void _openGoogleMaps(String destinationAddress) async {
    final query = Uri.encodeComponent(destinationAddress);
    final googleMapsUrl = Uri.parse(
        'https://www.google.com/maps/dir/?api=1&destination=$query&travelmode=driving&dir_action=navigate');
    try {
      if (await canLaunchUrl(googleMapsUrl)) {
        await launchUrl(googleMapsUrl, mode: LaunchMode.externalApplication);
      } else {
        await launchUrl(googleMapsUrl);
      }
    } catch (e) {
      debugPrint('Maps launch error: $e');
    }
  }

  // Direct Phone Dialer
  void _makePhoneCall(String phoneNumber) async {
    final clean = phoneNumber.replaceAll(RegExp(r'\D'), '');
    final telUri = Uri.parse('tel:$clean');
    try {
      if (await canLaunchUrl(telUri)) {
        await launchUrl(telUri);
      }
    } catch (e) {
      debugPrint('Call error: $e');
    }
  }

  // WhatsApp Messaging
  void _openWhatsApp(String phone, String message) async {
    final clean = phone.replaceAll(RegExp(r'\D'), '');
    final encoded = Uri.encodeComponent(message);
    final waUrl = Uri.parse('https://wa.me/$clean?text=$encoded');
    try {
      if (await canLaunchUrl(waUrl)) {
        await launchUrl(waUrl, mode: LaunchMode.externalApplication);
      } else {
        await launchUrl(waUrl);
      }
    } catch (e) {
      debugPrint('WhatsApp launch error: $e');
    }
  }

  // Accept Order from Jobs Feed Card
  Future<void> _handleAcceptJob(OrderModel order) async {
    setState(() => _isLoading = true);
    final res = await ApiService.acceptJob(order.parcelId);
    setState(() => _isLoading = false);

    if (res['success'] == true) {
      await _syncFeed();
      setState(() => _currentTab = 1); // Immediately jump to Active Trip!
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                '🎉 Order #${order.parcelId} Accepted! Head to pickup location.'),
            backgroundColor: const Color(0xFF22C55E),
          ),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['error'] ?? 'Could not accept order'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  // Verify Pickup OTP
  Future<void> _handleVerifyPickupOtp(String parcelId, String otp) async {
    if (otp.trim().length < 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter valid 4-digit Pickup PIN'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _isVerifyingOtp = true);
    final res = await ApiService.verifyPickupOtp(parcelId, otp.trim());
    setState(() => _isVerifyingOtp = false);

    if (res['success'] == true) {
      _pickupOtpController.clear();
      await _syncFeed();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                '✅ Pickup Verified! Parcel is now IN TRANSIT to delivery point.'),
            backgroundColor: Color(0xFF22C55E),
          ),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['error'] ?? 'Invalid Pickup PIN'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  // Verify Delivery OTP & Complete Trip
  Future<void> _handleVerifyDeliveryOtp(String parcelId, String otp) async {
    if (otp.trim().length < 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter valid 4-digit Delivery PIN'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _isVerifyingOtp = true);
    final res = await ApiService.verifyDeliveryOtp(parcelId, otp.trim());
    setState(() => _isVerifyingOtp = false);

    if (res['success'] == true) {
      _deliveryOtpController.clear();
      final finishedTrip = _activeTrip;
      await _syncFeed();
      await _loadEarnings();

      if (mounted) {
        _showTripCompletedDialog(finishedTrip);
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['error'] ?? 'Invalid Delivery PIN'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _showTripCompletedDialog(OrderModel? trip) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFF22C55E), width: 1.5),
        ),
        title: const Row(
          children: [
            Icon(Icons.check_circle_rounded, color: Color(0xFF22C55E), size: 28),
            SizedBox(width: 10),
            Text('Trip Completed! 🎉',
                style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Aapki Kamai: ₹${trip?.totalAmount ?? 0}',
              style: const TextStyle(
                  color: Color(0xFF22C55E),
                  fontSize: 22,
                  fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            const Text(
              '100% Direct Cash/UPI payment customer se prapt karein. Zero commission kata gaya hai.',
              style: TextStyle(color: Colors.white70, fontSize: 13),
            ),
            const SizedBox(height: 16),
            if (trip != null) ...[
              ElevatedButton.icon(
                onPressed: () {
                  final msg =
                      'Namaste ${trip.receiverName}! Aapka Rudraksha parcel successfully deliver ho gaya hai. Total Fare: ₹${trip.totalAmount}. Rudraksha Express choose karne ke liye dhanyawad!';
                  _openWhatsApp(trip.receiverPhone, msg);
                },
                icon: const Icon(Icons.receipt_long, color: Colors.black),
                label: const Text('Send WhatsApp Receipt',
                    style: TextStyle(
                        color: Colors.black, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF22C55E),
                  minimumSize: const Size(double.infinity, 44),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              setState(() => _currentTab = 0); // Back to feed
            },
            child: const Text('Continue to Next Orders',
                style: TextStyle(
                    color: Color(0xFFF97316), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // Profile Photo Pick & Upload
  void _showPhotoOptionsSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Driver Profile Photo',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 6),
              const Text(
                'Ye photo aapke Admin Panel aur customers ko verify karne ke liye dikhegi.',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF97316).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child:
                      const Icon(Icons.camera_alt_rounded, color: Color(0xFFF97316)),
                ),
                title: const Text('Take Selfie (Camera)',
                    style: TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: const Text('Mobile camera se live photo lein',
                    style: TextStyle(color: Colors.white54, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndUploadPhoto(ImageSource.camera);
                },
              ),
              const Divider(color: Colors.white12),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF22C55E).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.photo_library_rounded,
                      color: Color(0xFF22C55E)),
                ),
                title: const Text('Choose from Gallery',
                    style: TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: const Text('Phone gallery se photo select karein',
                    style: TextStyle(color: Colors.white54, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndUploadPhoto(ImageSource.gallery);
                },
              ),
              if (ApiService.currentDriver?.avatarUrl != null &&
                  ApiService.currentDriver!.avatarUrl!.isNotEmpty) ...[
                const Divider(color: Colors.white12),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.red.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child:
                        const Icon(Icons.delete_outline_rounded, color: Colors.red),
                  ),
                  title: const Text('Remove Current Photo',
                      style: TextStyle(
                          color: Colors.red, fontWeight: FontWeight.bold)),
                  subtitle: const Text('Default avatar par reset karein',
                      style: TextStyle(color: Colors.white54, fontSize: 12)),
                  onTap: () {
                    Navigator.pop(ctx);
                    _removePhoto();
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _pickAndUploadPhoto(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final XFile? image = await picker.pickImage(
        source: source,
        maxWidth: 320,
        maxHeight: 320,
        imageQuality: 80,
      );
      if (image == null) return;

      final bytes = await image.readAsBytes();
      final base64Str = 'data:image/jpeg;base64,${base64Encode(bytes)}';

      setState(() => _isLoading = true);
      final res = await ApiService.uploadAvatar(base64Str);
      setState(() => _isLoading = false);

      if (mounted) {
        if (res['success'] == true) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                  '📸 Profile photo uploaded & synced with Database and Admin Panel!'),
              backgroundColor: Color(0xFF22C55E),
            ),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(res['error'] ?? 'Upload failed'),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    } catch (e) {
      setState(() => _isLoading = false);
      debugPrint('Photo upload error: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Photo error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _removePhoto() async {
    setState(() => _isLoading = true);
    await ApiService.removeAvatar();
    setState(() => _isLoading = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('🗑️ Profile photo removed.'),
          backgroundColor: Colors.orange,
        ),
      );
    }
  }

  Widget _buildAvatarWidget({double size = 42, bool showCameraOverlay = false}) {
    final avatar = ApiService.currentDriver?.avatarUrl;
    Widget img;

    if (avatar != null && avatar.isNotEmpty) {
      if (avatar.startsWith('data:image')) {
        try {
          final cleanBase64 = avatar.split(',').last;
          img = Image.memory(
            base64Decode(cleanBase64),
            width: size,
            height: size,
            fit: BoxFit.cover,
            errorBuilder: (ctx, err, stack) =>
                Image.asset('assets/logo.png', width: size, height: size, fit: BoxFit.cover),
          );
        } catch (_) {
          img = Image.asset('assets/logo.png', width: size, height: size, fit: BoxFit.cover);
        }
      } else if (avatar.startsWith('http')) {
        img = Image.network(
          avatar,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (ctx, err, stack) =>
              Image.asset('assets/logo.png', width: size, height: size, fit: BoxFit.cover),
        );
      } else {
        img = Image.asset('assets/logo.png', width: size, height: size, fit: BoxFit.cover);
      }
    } else {
      img = Image.asset('assets/logo.png', width: size, height: size, fit: BoxFit.cover);
    }

    return Stack(
      children: [
        Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: const Color(0xFFF97316),
              width: 2,
            ),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFFF97316).withValues(alpha: 0.35),
                blurRadius: 10,
                spreadRadius: 1,
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: img,
        ),
        if (showCameraOverlay)
          Positioned(
            right: 0,
            bottom: 0,
            child: GestureDetector(
              onTap: _showPhotoOptionsSheet,
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(
                  color: Color(0xFFF97316),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(color: Colors.black45, blurRadius: 4),
                  ],
                ),
                child: const Icon(Icons.camera_alt, color: Colors.white, size: 14),
              ),
            ),
          ),
      ],
    );
  }

  void _triggerTestAlert() {
    final testOrder = OrderModel(
      parcelId: 'RDR-${(10000 + (DateTime.now().millisecond * 80)).toInt()}',
      pickupAddress: 'Vaishali Nagar (Near Amrapali Circle), Jaipur',
      dropAddress: 'Mansarovar Metro Station (Pillar 64), Jaipur',
      senderName: 'Rajesh Sharma',
      senderPhone: '9829012345',
      receiverName: 'Pooja Verma',
      receiverPhone: '9829067890',
      totalAmount: 260.0,
      bookingStatus: 'driver_assigned',
      isDirectAssignment: true,
    );
    _triggerOrderAlert(testOrder);
  }

  @override
  Widget build(BuildContext context) {
    final driver = ApiService.currentDriver;
    final isOnDuty = driver?.onDuty ?? true;

    return Scaffold(
      backgroundColor: const Color(0xFF090D16),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F172A),
        elevation: 2,
        title: Row(
          children: [
            GestureDetector(
              onTap: () => setState(() => _currentTab = 2), // Go to profile
              child: _buildAvatarWidget(size: 38),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    driver?.driverName ?? 'Rudraksha Rider',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    '${driver?.vehicleType ?? 'Bike'} • ${driver?.vehicleNumber ?? '-'}',
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          // Duty toggle
          Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: FilterChip(
              avatar: Icon(
                Icons.circle,
                size: 10,
                color: isOnDuty ? const Color(0xFF22C55E) : Colors.red,
              ),
              label: Text(
                isOnDuty ? 'ON DUTY' : 'OFF DUTY',
                style: TextStyle(
                  color: isOnDuty ? const Color(0xFF22C55E) : Colors.red,
                  fontWeight: FontWeight.bold,
                  fontSize: 11,
                ),
              ),
              backgroundColor: isOnDuty
                  ? const Color(0xFF22C55E).withValues(alpha: 0.12)
                  : Colors.red.withValues(alpha: 0.12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(
                  color: isOnDuty
                      ? const Color(0xFF22C55E).withValues(alpha: 0.4)
                      : Colors.red.withValues(alpha: 0.4),
                ),
              ),
              onSelected: (val) => _handleDutyToggle(val),
            ),
          ),
          // Logout
          IconButton(
            icon: const Icon(Icons.logout_rounded, color: Colors.white54, size: 20),
            tooltip: 'Logout',
            onPressed: () async {
              final confirm = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  backgroundColor: const Color(0xFF0F172A),
                  title: const Text('Log Out?', style: TextStyle(color: Colors.white)),
                  content: const Text(
                      'Aap account se logout ho jayenge aur order alerts band ho jayenge.',
                      style: TextStyle(color: Colors.white70)),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Cancel', style: TextStyle(color: Colors.white54)),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Log Out', style: TextStyle(color: Colors.red)),
                    ),
                  ],
                ),
              );
              if (confirm == true) {
                await ApiService.logout();
                if (context.mounted) {
                  Navigator.pushReplacement(
                    context,
                    MaterialPageRoute(builder: (_) => const LoginScreen()),
                  );
                }
              }
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await _syncFeed();
          await _loadEarnings();
        },
        color: const Color(0xFF22C55E),
        backgroundColor: const Color(0xFF1E293B),
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: Color(0xFF22C55E)),
              )
            : _buildCurrentTab(),
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentTab,
        onTap: (idx) => setState(() => _currentTab = idx),
        backgroundColor: const Color(0xFF0F172A),
        selectedItemColor: const Color(0xFF22C55E),
        unselectedItemColor: Colors.white54,
        type: BottomNavigationBarType.fixed,
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11),
        unselectedLabelStyle: const TextStyle(fontSize: 10),
        items: [
          const BottomNavigationBarItem(
            icon: Icon(Icons.list_alt_rounded),
            label: 'Jobs Feed',
          ),
          BottomNavigationBarItem(
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.two_wheeler_rounded),
                if (_activeTrip != null)
                  Positioned(
                    right: -2,
                    top: -2,
                    child: Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: Color(0xFFF97316),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
              ],
            ),
            label: 'Active Trip',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.person_rounded),
            label: 'My Profile',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.headset_mic_rounded),
            label: 'Support',
          ),
        ],
      ),
    );
  }

  Widget _buildCurrentTab() {
    switch (_currentTab) {
      case 0:
        return _buildFeedView();
      case 1:
        return _buildActiveTripTab();
      case 2:
        return _buildProfileTab();
      case 3:
        return _buildSupportTab();
      default:
        return _buildFeedView();
    }
  }

  // ==========================================
  // TAB 0: JOBS FEED
  // ==========================================
  Widget _buildFeedView() {
    final driver = ApiService.currentDriver;
    final isOnDuty = driver?.onDuty ?? true;
    final totalEarn = _earningsData?['totalEarnings'] ?? _earningsData?['allTimeEarnings'] ?? _earningsData?['todayEarnings'] ?? 0;
    final tripsCount = _earningsData?['completedTrips'] ?? _earningsData?['completedTripsCount'] ?? 0;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Off Duty Warning Banner if offline
        if (!isOnDuty)
          Container(
            padding: const EdgeInsets.all(14),
            margin: const EdgeInsets.only(bottom: 14),
            decoration: BoxDecoration(
              color: Colors.red.withValues(alpha: 0.15),
              border: Border.all(color: Colors.red.withValues(alpha: 0.4)),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: Colors.red, size: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Aap abhi OFF DUTY hain',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        'Orders aur Siren Alerts prapt karne ke liye ON DUTY switch karein.',
                        style: TextStyle(color: Colors.white70, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => _handleDutyToggle(true),
                  style: TextButton.styleFrom(
                    backgroundColor: const Color(0xFF22C55E),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  ),
                  child: const Text('Go ON DUTY',
                      style: TextStyle(
                          color: Colors.black, fontWeight: FontWeight.bold, fontSize: 11)),
                ),
              ],
            ),
          ),

        // Siren & Push Alert Test Card
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          margin: const EdgeInsets.only(bottom: 14),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white12),
          ),
          child: Row(
            children: [
              const Icon(Icons.notifications_active, color: Color(0xFFF97316), size: 20),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Urgent Siren & Alert System Active',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ),
              TextButton(
                onPressed: _triggerTestAlert,
                style: TextButton.styleFrom(
                  backgroundColor: const Color(0xFFF97316).withValues(alpha: 0.15),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  minimumSize: Size.zero,
                ),
                child: const Text('Test Siren',
                    style: TextStyle(color: Color(0xFFF97316), fontSize: 11)),
              ),
            ],
          ),
        ),

        // Stats Ribbon (Today's Earnings, Trips, Rating)
        Row(
          children: [
            Expanded(
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Today Earnings',
                        style: TextStyle(color: Colors.white54, fontSize: 10)),
                    const SizedBox(height: 4),
                    Text('₹$totalEarn',
                        style: const TextStyle(
                            color: Color(0xFF22C55E),
                            fontSize: 18,
                            fontWeight: FontWeight.w900)),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Trips Done',
                        style: TextStyle(color: Colors.white54, fontSize: 10)),
                    const SizedBox(height: 4),
                    Text('$tripsCount',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w900)),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white12),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Rider Rating',
                        style: TextStyle(color: Colors.white54, fontSize: 10)),
                    SizedBox(height: 4),
                    Text('★ 4.9',
                        style: TextStyle(
                            color: Color(0xFFF97316),
                            fontSize: 18,
                            fontWeight: FontWeight.w900)),
                  ],
                ),
              ),
            ),
          ],
        ),

        const SizedBox(height: 16),

        // Active Trip Highlight Banner (if running)
        if (_activeTrip != null) ...[
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1E293B), Color(0xFF0F172A)],
              ),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFF22C55E), width: 1.5),
            ),
            child: Row(
              children: [
                const Icon(Icons.electric_moped_rounded,
                    color: Color(0xFF22C55E), size: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '🛵 Active Trip chal rahi hai!',
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      Text(
                        'Kamai: ₹${_activeTrip!.totalAmount} • ${_activeTrip!.bookingStatus}',
                        style: const TextStyle(color: Color(0xFF22C55E), fontSize: 11),
                      ),
                    ],
                  ),
                ),
                ElevatedButton(
                  onPressed: () => setState(() => _currentTab = 1),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF22C55E),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                  child: const Text('Open Trip',
                      style: TextStyle(
                          color: Colors.black, fontWeight: FontWeight.bold, fontSize: 11)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],

        // Available Pool Jobs Section Header
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    color: Color(0xFF22C55E),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Available Orders (${_availableJobs.length})',
                  style: const TextStyle(
                      color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            TextButton.icon(
              onPressed: _syncFeed,
              icon: const Icon(Icons.refresh, size: 14, color: Color(0xFFF97316)),
              label: const Text('Refresh',
                  style: TextStyle(color: Color(0xFFF97316), fontSize: 12)),
            ),
          ],
        ),
        const SizedBox(height: 10),

        // Available Jobs List or Empty Radar State
        if (_availableJobs.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white12),
            ),
            child: const Column(
              children: [
                Icon(Icons.radar_rounded, size: 48, color: Color(0xFF22C55E)),
                SizedBox(height: 14),
                Text(
                  'Scanning for Parcel Requests...',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                ),
                SizedBox(height: 6),
                Text(
                  'Admin ya Customer ka naya order aate hi turant yahan dikhega aur Siren bajega.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ],
            ),
          )
        else
          ..._availableJobs.map((job) => _buildAvailableJobCard(job)),
      ],
    );
  }

  Widget _buildAvailableJobCard(OrderModel job) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFF97316).withValues(alpha: 0.4)),
        boxShadow: const [
          BoxShadow(color: Colors.black38, blurRadius: 8, offset: Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFF97316).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '#${job.parcelId}',
                  style: const TextStyle(
                      color: Color(0xFFF97316),
                      fontWeight: FontWeight.bold,
                      fontSize: 11),
                ),
              ),
              Text(
                '₹${job.totalAmount}',
                style: const TextStyle(
                    color: Color(0xFF22C55E),
                    fontSize: 20,
                    fontWeight: FontWeight.w900),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Route: Pickup
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.arrow_upward_rounded, color: Color(0xFF22C55E), size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Pickup Location',
                        style: TextStyle(color: Colors.white54, fontSize: 10)),
                    Text(job.pickupAddress,
                        style: const TextStyle(
                            color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Route: Drop
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.location_on_rounded, color: Colors.redAccent, size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Drop Location',
                        style: TextStyle(color: Colors.white54, fontSize: 10)),
                    Text(job.dropAddress,
                        style: const TextStyle(
                            color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Accept Order Button
          ElevatedButton.icon(
            onPressed: () => _handleAcceptJob(job),
            icon: const Icon(Icons.check_circle_outline, color: Colors.black, size: 18),
            label: Text(
              'ACCEPT ORDER (Kamai ₹${job.totalAmount})',
              style: const TextStyle(
                  color: Colors.black, fontWeight: FontWeight.w900, fontSize: 13),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF22C55E),
              minimumSize: const Size(double.infinity, 44),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================
  // TAB 1: ACTIVE TRIP
  // ==========================================
  Widget _buildActiveTripTab() {
    if (_activeTrip == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 90,
                height: 90,
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white12),
                ),
                child: const Icon(Icons.two_wheeler_rounded,
                    color: Color(0xFFF97316), size: 44),
              ),
              const SizedBox(height: 18),
              const Text(
                'No Active Trip Right Now',
                style: TextStyle(
                    color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text(
                'Jobs Feed me jakar available orders accept karein ya Admin se assign hone ka intezar karein.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white54, fontSize: 13),
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: () => setState(() => _currentTab = 0),
                icon: const Icon(Icons.list_alt, color: Colors.black),
                label: const Text('Browse Jobs Feed',
                    style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF22C55E),
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final trip = _activeTrip!;
    final isPickedUp = trip.bookingStatus == 'picked_up' ||
        trip.bookingStatus == 'in_transit' ||
        trip.bookingStatus == 'out_for_delivery';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Live Trip Header Ribbon
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
            ),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF22C55E), width: 1.5),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: Color(0xFF22C55E),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        isPickedUp ? 'IN TRANSIT TO DROP' : 'HEADING TO PICKUP',
                        style: const TextStyle(
                            color: Color(0xFF22C55E),
                            fontWeight: FontWeight.bold,
                            fontSize: 11),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text('#${trip.parcelId}',
                      style: const TextStyle(
                          color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Total Cash/UPI',
                      style: TextStyle(color: Colors.white54, fontSize: 10)),
                  Text('₹${trip.totalAmount}',
                      style: const TextStyle(
                          color: Color(0xFF22C55E),
                          fontSize: 22,
                          fontWeight: FontWeight.w900)),
                ],
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // STEP 1: PICKUP POINT CARD
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
                color: isPickedUp ? Colors.white12 : const Color(0xFF22C55E),
                width: isPickedUp ? 1 : 1.5),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: isPickedUp ? const Color(0xFF22C55E) : const Color(0xFFF97316),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: isPickedUp
                          ? const Icon(Icons.check, color: Colors.black, size: 16)
                          : const Text('1',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    isPickedUp ? 'Step 1: Picked Up ✓' : 'Step 1: Pickup from Sender',
                    style: TextStyle(
                      color: isPickedUp ? const Color(0xFF22C55E) : Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(trip.pickupAddress,
                  style: const TextStyle(
                      color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Text('Sender: ${trip.senderName} • ${trip.senderPhone}',
                  style: const TextStyle(color: Colors.white54, fontSize: 12)),
              const SizedBox(height: 14),

              // Action Buttons: Navigate GPS & Call
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _openGoogleMaps(trip.pickupAddress),
                      icon: const Icon(Icons.navigation_rounded, size: 16, color: Colors.white),
                      label: const Text('GPS Maps',
                          style: TextStyle(color: Colors.white, fontSize: 12)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1E293B),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _makePhoneCall(trip.senderPhone),
                      icon: const Icon(Icons.call, size: 16, color: Colors.white),
                      label: const Text('Call Sender',
                          style: TextStyle(color: Colors.white, fontSize: 12)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1E293B),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                ],
              ),

              // Pickup OTP verification
              if (!isPickedUp) ...[
                const SizedBox(height: 16),
                const Divider(color: Colors.white12),
                const SizedBox(height: 8),
                const Text('Sender se 4-digit Pickup PIN lein:',
                    style: TextStyle(color: Colors.white70, fontSize: 12)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _pickupOtpController,
                        keyboardType: TextInputType.number,
                        maxLength: 4,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 8),
                        decoration: InputDecoration(
                          counterText: '',
                          hintText: '----',
                          hintStyle: const TextStyle(color: Colors.white24),
                          filled: true,
                          fillColor: const Color(0xFF1E293B),
                          contentPadding: const EdgeInsets.symmetric(vertical: 8),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    ElevatedButton(
                      onPressed: _isVerifyingOtp
                          ? null
                          : () => _handleVerifyPickupOtp(
                              trip.parcelId, _pickupOtpController.text),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF22C55E),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                      child: _isVerifyingOtp
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                  color: Colors.black, strokeWidth: 2))
                          : const Text('Verify Pickup',
                              style: TextStyle(
                                  color: Colors.black, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),

        const SizedBox(height: 16),

        // STEP 2: DROP POINT CARD
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
                color: isPickedUp ? const Color(0xFFF97316) : Colors.white12,
                width: isPickedUp ? 1.5 : 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 24,
                    height: 24,
                    decoration: const BoxDecoration(
                      color: Color(0xFFF97316),
                      shape: BoxShape.circle,
                    ),
                    child: const Center(
                      child: Text('2',
                          style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 12)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    'Step 2: Deliver to Receiver',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(trip.dropAddress,
                  style: const TextStyle(
                      color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Text('Receiver: ${trip.receiverName} • ${trip.receiverPhone}',
                  style: const TextStyle(color: Colors.white54, fontSize: 12)),
              const SizedBox(height: 14),

              // Action Buttons: Navigate GPS & Call
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _openGoogleMaps(trip.dropAddress),
                      icon: const Icon(Icons.navigation_rounded, size: 16, color: Colors.white),
                      label: const Text('GPS Maps',
                          style: TextStyle(color: Colors.white, fontSize: 12)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1E293B),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _makePhoneCall(trip.receiverPhone),
                      icon: const Icon(Icons.call, size: 16, color: Colors.white),
                      label: const Text('Call Receiver',
                          style: TextStyle(color: Colors.white, fontSize: 12)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1E293B),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                ],
              ),

              // Delivery OTP verification
              if (isPickedUp) ...[
                const SizedBox(height: 16),
                const Divider(color: Colors.white12),
                const SizedBox(height: 8),
                const Text('Receiver se 4-digit Delivery PIN lein:',
                    style: TextStyle(color: Colors.white70, fontSize: 12)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _deliveryOtpController,
                        keyboardType: TextInputType.number,
                        maxLength: 4,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 8),
                        decoration: InputDecoration(
                          counterText: '',
                          hintText: '----',
                          hintStyle: const TextStyle(color: Colors.white24),
                          filled: true,
                          fillColor: const Color(0xFF1E293B),
                          contentPadding: const EdgeInsets.symmetric(vertical: 8),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    ElevatedButton(
                      onPressed: _isVerifyingOtp
                          ? null
                          : () => _handleVerifyDeliveryOtp(
                              trip.parcelId, _deliveryOtpController.text),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF22C55E),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                      child: _isVerifyingOtp
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                  color: Colors.black, strokeWidth: 2))
                          : const Text('Complete Trip',
                              style: TextStyle(
                                  color: Colors.black, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ==========================================
  // TAB 2: MY PROFILE & PHOTO UPLOAD
  // ==========================================
  Widget _buildProfileTab() {
    final driver = ApiService.currentDriver;
    final isOnDuty = driver?.onDuty ?? true;
    final totalEarn = _earningsData?['totalEarnings'] ?? _earningsData?['allTimeEarnings'] ?? _earningsData?['todayEarnings'] ?? 0;
    final tripsCount = _earningsData?['completedTrips'] ?? _earningsData?['completedTripsCount'] ?? 0;
    final tripsList = (_earningsData?['trips'] as List?) ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Driver ID Card with Photo Upload
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: Colors.white12),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  _buildAvatarWidget(size: 64, showCameraOverlay: true),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                driver?.driverName ?? 'Partner Profile',
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF22C55E).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Text('✓ Verified',
                                  style: TextStyle(
                                      color: Color(0xFF22C55E),
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          driver?.phone.isNotEmpty == true ? '+91 ${driver!.phone}' : '-',
                          style: const TextStyle(color: Colors.white70, fontSize: 13),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${driver?.vehicleType ?? 'Bike'} • ${driver?.vehicleNumber ?? '-'}',
                          style: const TextStyle(color: Color(0xFFF97316), fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _showPhotoOptionsSheet,
                icon: const Icon(Icons.camera_enhance_rounded, size: 16, color: Color(0xFFF97316)),
                label: const Text('Change Profile Photo (Database Sync)',
                    style: TextStyle(color: Color(0xFFF97316), fontSize: 12)),
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: const Color(0xFFF97316).withValues(alpha: 0.4)),
                  minimumSize: const Size(double.infinity, 38),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 14),
              const Divider(color: Colors.white12),
              const SizedBox(height: 10),

              // Badges Grid
              Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Driving License',
                              style: TextStyle(color: Colors.white54, fontSize: 10)),
                          const SizedBox(height: 2),
                          Text(driver?.dlNumber ?? 'RJ14-VERIFIED',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Base City & Shift',
                              style: TextStyle(color: Colors.white54, fontSize: 10)),
                          const SizedBox(height: 2),
                          Text('${driver?.city ?? 'Jaipur'} • ${driver?.shift ?? 'Full Time'}',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Duty Switch Card
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white12),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Rider Duty Status',
                      style: TextStyle(color: Colors.white54, fontSize: 11)),
                  const SizedBox(height: 2),
                  Text(
                    isOnDuty ? '🟢 On Duty (Receiving Orders)' : '🔴 Off Duty (Paused)',
                    style: TextStyle(
                        color: isOnDuty ? const Color(0xFF22C55E) : Colors.red,
                        fontSize: 13,
                        fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              Switch(
                value: isOnDuty,
                activeThumbColor: const Color(0xFF22C55E),
                onChanged: (val) => _handleDutyToggle(val),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // 100% Direct Income Card
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFF22C55E).withValues(alpha: 0.3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Total Driver Income (100% Aapki Kamai)',
                      style: TextStyle(color: Colors.white54, fontSize: 11)),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFF22C55E).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Text('✓ 0% Commission',
                        style: TextStyle(
                            color: Color(0xFF22C55E),
                            fontSize: 10,
                            fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '₹$totalEarn',
                style: const TextStyle(
                    color: Color(0xFF22C55E),
                    fontSize: 28,
                    fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 4),
              Text(
                '$tripsCount Trips Completed • Direct Cash/UPI Customer Se Prapt Kiya',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Recent Completed Deliveries List
        if (tripsList.isNotEmpty) ...[
          const Text('Recent Completed Deliveries',
              style: TextStyle(
                  color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          ...tripsList.take(5).map((t) => Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white12),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('#${t['parcel_id'] ?? t['id'] ?? '-'}',
                            style: const TextStyle(
                                color: Colors.white, fontWeight: FontWeight.bold)),
                        Text('${t['drop_address'] ?? t['drop'] ?? 'Jaipur'}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white54, fontSize: 11)),
                      ],
                    ),
                    Text('+₹${t['total_amount'] ?? t['driver_earning'] ?? t['customer_price'] ?? 0}',
                        style: const TextStyle(
                            color: Color(0xFF22C55E), fontWeight: FontWeight.bold)),
                  ],
                ),
              )),
          const SizedBox(height: 16),
        ],

        // Check for App Updates Button
        ElevatedButton.icon(
          onPressed: () =>
              UpdateService.checkAndPromptUpdate(context, showNoUpdateToast: true),
          icon: const Icon(Icons.system_update_rounded, color: Colors.black, size: 18),
          label: Text('Check for App Updates (v${UpdateService.currentVersion})',
              style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF22C55E),
            minimumSize: const Size(double.infinity, 44),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 12),

        // Logout Button
        OutlinedButton.icon(
          onPressed: () async {
            await ApiService.logout();
            if (mounted) {
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            }
          },
          icon: const Icon(Icons.logout, color: Colors.red, size: 16),
          label: const Text('Log Out from Driver App',
              style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
          style: OutlinedButton.styleFrom(
            side: BorderSide(color: Colors.red.withValues(alpha: 0.4)),
            minimumSize: const Size(double.infinity, 44),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ],
    );
  }

  // ==========================================
  // TAB 3: SUPPORT
  // ==========================================
  Widget _buildSupportTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.headset_mic_rounded, color: Color(0xFFF97316), size: 28),
                  SizedBox(width: 12),
                  Text('24x7 Driver Partner Desk',
                      style: TextStyle(
                          color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Kisi bhi order, pickup PIN, location ya payment problem ke liye humse turant sampark karein.',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              const SizedBox(height: 18),

              // Helpline Call Button
              ElevatedButton.icon(
                onPressed: () => _makePhoneCall('7296831460'),
                icon: const Icon(Icons.call, color: Colors.black),
                label: const Text('Call Fleet Helpline (+91 72968 31460)',
                    style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF22C55E),
                  minimumSize: const Size(double.infinity, 46),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 12),

              // WhatsApp Chat Button
              ElevatedButton.icon(
                onPressed: () => _openWhatsApp(
                    '917296831460', 'Hello Admin, I need help with my Rudraksha Driver Account.'),
                icon: const Icon(Icons.chat_bubble_outline, color: Colors.white),
                label: const Text('Chat with Admin on WhatsApp',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF1E293B),
                  side: const BorderSide(color: Colors.white24),
                  minimumSize: const Size(double.infinity, 46),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Partner Guidelines Box
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white12),
          ),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Partner Guidelines & Policies',
                  style: TextStyle(
                      color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
              SizedBox(height: 12),
              _SupportBullet(
                  icon: Icons.percent,
                  title: '0% Platform Commission',
                  desc: 'Aapka 100% fare aapka hai. Rudraksha koi commission nahi kat-ta.'),
              SizedBox(height: 10),
              _SupportBullet(
                  icon: Icons.payments_outlined,
                  title: 'Direct Cash / UPI Payment',
                  desc: 'Delivery ke waqt customer se direct Cash ya apne UPI QR code par payment lein.'),
              SizedBox(height: 10),
              _SupportBullet(
                  icon: Icons.pin_outlined,
                  title: 'Mandatory PIN Verification',
                  desc: 'Pickup par sender ka Pickup PIN aur delivery par receiver ka Delivery PIN jarur lein.'),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Office Details
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Rudraksha Express Fleet Hub',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              SizedBox(height: 4),
              Text('Vaishali Nagar / Mansarovar Hub, Jaipur, Rajasthan',
                  style: TextStyle(color: Colors.white54, fontSize: 12)),
              SizedBox(height: 2),
              Text('Official Driver App Version: 1.2.0 • Build Release',
                  style: TextStyle(color: Color(0xFFF97316), fontSize: 11)),
            ],
          ),
        ),
      ],
    );
  }
}

class _SupportBullet extends StatelessWidget {
  final IconData icon;
  final String title;
  final String desc;

  const _SupportBullet({
    required this.icon,
    required this.title,
    required this.desc,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: const Color(0xFFF97316).withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: const Color(0xFFF97316), size: 16),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
              const SizedBox(height: 2),
              Text(desc, style: const TextStyle(color: Colors.white54, fontSize: 11)),
            ],
          ),
        ),
      ],
    );
  }
}
