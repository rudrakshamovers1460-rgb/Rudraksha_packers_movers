import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import '../models/order_model.dart';
import 'alert_manager.dart';

@pragma('vm:entry-point')
void startForegroundCallback() {
  FlutterForegroundTask.setTaskHandler(DriverTaskHandler());
}

class DriverTaskHandler extends TaskHandler {
  String? _token;
  String? _lastNotifiedParcelId;

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    debugPrint('[BackgroundService] Started by ${starter.name}');
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('rudraksha_driver_token');
    await AlertManager().init();
  }

  @override
  void onRepeatEvent(DateTime timestamp) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _token ??= prefs.getString('rudraksha_driver_token');
      if (_token == null || _token!.isEmpty) return;

      final rawSession = prefs.getString('rudraksha_driver_session');
      bool onDuty = true;
      if (rawSession != null) {
        try {
          final Map<String, dynamic> json = jsonDecode(rawSession);
          onDuty = json['onDuty'] ?? true;
        } catch (_) {}
      }

      if (!onDuty) return;

      // 1. Send GPS Location to Server
      try {
        final position = await Geolocator.getLastKnownPosition() ??
            await Geolocator.getCurrentPosition(
              locationSettings: const LocationSettings(
                accuracy: LocationAccuracy.high,
                timeLimit: Duration(seconds: 5),
              ),
            );

        final baseUrl = prefs.getString('rudraksha_api_base_url') ?? ApiConfig.currentBaseUrl;
        final locUrl = Uri.parse('$baseUrl/rider/location');
        await http.post(
          locUrl,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $_token',
          },
          body: jsonEncode({
            'latitude': position.latitude,
            'longitude': position.longitude,
            'speed': position.speed,
            'heading': position.heading,
            'accuracy': position.accuracy,
          }),
        ).timeout(const Duration(seconds: 4));
      } catch (_) {}

      // 2. Poll for New Orders / Assigned Jobs
      final baseUrl = prefs.getString('rudraksha_api_base_url') ?? ApiConfig.currentBaseUrl;
      final jobsUrl = Uri.parse('$baseUrl/rider/jobs');
      final res = await http.get(
        jobsUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
      ).timeout(const Duration(seconds: 5));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final activeRaw = data['activeTrip'];

        if (activeRaw != null) {
          final order = OrderModel.fromJson(activeRaw, isDirect: true);
          final status = order.bookingStatus;
          final isPending = (status == 'driver_assigned' || status == 'received');

          final prefs = await SharedPreferences.getInstance();
          final declinedList = prefs.getStringList('rudraksha_driver_declined_parcels') ?? [];
          final isDeclined = declinedList.contains(order.parcelId) || status == 'driver_declined';

          if (isPending && !isDeclined && _lastNotifiedParcelId != order.parcelId) {
            _lastNotifiedParcelId = order.parcelId;
            debugPrint('[BackgroundService] 🚨 NEW ASSIGNED ORDER: ${order.parcelId}');

            // Wake up screen even if locked or off!
            try {
              FlutterForegroundTask.wakeUpScreen();
              FlutterForegroundTask.setOnLockScreenVisibility(true);
            } catch (_) {}

            // Trigger sound, vibration & lock screen notification with Accept/Decline actions!
            await AlertManager().triggerNewOrderAlert(order);

            // Update foreground service notification with Mute, Accept & Decline action buttons
            await FlutterForegroundTask.updateService(
              notificationTitle: '🔔 NAYA ORDER ASSIGNED! (₹${order.totalAmount.toInt()})',
              notificationText: '📍 ${order.pickupAddress.split(',')[0]} ➔ ${order.dropAddress.split(',')[0]}',
              notificationButtons: [
                const NotificationButton(id: 'silence_order', text: '🔇 MUTE'),
                const NotificationButton(id: 'accept_order', text: '✅ ACCEPT'),
                const NotificationButton(id: 'decline_order', text: '❌ DECLINE'),
              ],
            );

            // Notify UI isolate
            FlutterForegroundTask.sendDataToMain({
              'type': 'new_order_alert',
              'order': activeRaw,
            });
          }
        }
      }
    } catch (e) {
      debugPrint('[BackgroundService] Poll error: $e');
    }
  }

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {
    debugPrint('[BackgroundService] Destroyed');
    await AlertManager().stopAlert();
  }

  @override
  void onNotificationButtonPressed(String id) async {
    debugPrint('[BackgroundService] Notification button clicked: $id');
    if (id == 'silence_order') {
      // Instantly silence sound and vibration, but keep order active for review
      await AlertManager().muteSound();
      await FlutterForegroundTask.updateService(
        notificationTitle: '🔔 Order Assigned (Sound Muted)',
        notificationText: 'Tap ACCEPT to start or DECLINE to skip',
        notificationButtons: [
          const NotificationButton(id: 'accept_order', text: '✅ ACCEPT'),
          const NotificationButton(id: 'decline_order', text: '❌ DECLINE'),
        ],
      );
    } else if (id == 'accept_order') {
      await AlertManager().stopAlert();
      if (_lastNotifiedParcelId != null) {
        try {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString('rudraksha_driver_token');
          final baseUrl = prefs.getString('rudraksha_api_base_url') ?? ApiConfig.currentBaseUrl;
          final acceptUrl = Uri.parse('$baseUrl/rider/jobs/$_lastNotifiedParcelId/accept');
          await http.post(
            acceptUrl,
            headers: {
              'Content-Type': 'application/json',
              if (token != null) 'Authorization': 'Bearer $token',
            },
          );
        } catch (e) {
          debugPrint('[BackgroundService] Accept order error: $e');
        }
      }
      await FlutterForegroundTask.updateService(
        notificationTitle: '🟢 Rudraksha Driver: ON DUTY',
        notificationText: 'Trip Accepted • Heading to pickup',
        notificationButtons: [],
      );
      FlutterForegroundTask.launchApp();
    } else if (id == 'decline_order') {
      await AlertManager().stopAlert();
      if (_lastNotifiedParcelId != null) {
        try {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString('rudraksha_driver_token');
          final baseUrl = prefs.getString('rudraksha_api_base_url') ?? ApiConfig.currentBaseUrl;
          final declineUrl = Uri.parse('$baseUrl/rider/jobs/$_lastNotifiedParcelId/decline');
          await http.post(
            declineUrl,
            headers: {
              'Content-Type': 'application/json',
              if (token != null) 'Authorization': 'Bearer $token',
            },
            body: jsonEncode({'reason': 'Declined via notification button'}),
          );

          final declinedList = prefs.getStringList('rudraksha_driver_declined_parcels') ?? [];
          if (!declinedList.contains(_lastNotifiedParcelId)) {
            declinedList.add(_lastNotifiedParcelId!);
            await prefs.setStringList('rudraksha_driver_declined_parcels', declinedList);
          }
        } catch (e) {
          debugPrint('[BackgroundService] Decline order error: $e');
        }
      }
      await FlutterForegroundTask.updateService(
        notificationTitle: '🟢 Rudraksha Driver: ON DUTY',
        notificationText: '📡 Live GPS Active • Order declined',
        notificationButtons: [],
      );
    } else {
      FlutterForegroundTask.launchApp();
    }
  }

  @override
  void onNotificationPressed() {
    FlutterForegroundTask.launchApp();
  }
}

class BackgroundService {
  static bool _isInitialized = false;

  static Future<void> init() async {
    if (_isInitialized) return;
    _isInitialized = true;

    FlutterForegroundTask.initCommunicationPort();

    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'rudraksha_driver_service_v1',
        channelName: 'Rudraksha Fleet On-Duty Service',
        channelDescription:
            'Keeps driver online for receiving orders with siren & lock screen alerts.',
        channelImportance: NotificationChannelImportance.HIGH,
        priority: NotificationPriority.HIGH,
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.repeat(5000),
        autoRunOnBoot: true,
        autoRunOnMyPackageReplaced: true,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
  }

  static Future<void> requestPermissions() async {
    final NotificationPermission notifPermission =
        await FlutterForegroundTask.checkNotificationPermission();
    if (notifPermission != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
    }

    if (Platform.isAndroid) {
      if (!await FlutterForegroundTask.isIgnoringBatteryOptimizations) {
        await FlutterForegroundTask.requestIgnoreBatteryOptimization();
      }
    }
  }

  static Future<void> start() async {
    try {
      await init();
      await requestPermissions();

      if (await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.restartService();
      } else {
        await FlutterForegroundTask.startService(
          serviceId: 1460,
          notificationTitle: '🟢 Rudraksha Driver: ON DUTY',
          notificationText: '📡 Live GPS Active • Listening for assigned parcels',
          notificationIcon: null,
          notificationButtons: [
            const NotificationButton(id: 'open_app', text: 'Open Dashboard'),
          ],
          callback: startForegroundCallback,
        );
      }
    } catch (e) {
      debugPrint('[BackgroundService] start error: $e');
    }
  }

  static Future<void> stop() async {
    try {
      if (await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
    } catch (e) {
      debugPrint('[BackgroundService] stop error: $e');
    }
  }

  static Future<bool> isRunning() async {
    return await FlutterForegroundTask.isRunningService;
  }
}
