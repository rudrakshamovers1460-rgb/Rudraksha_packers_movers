import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import '../models/driver_model.dart';
import '../models/order_model.dart';

class ApiService {
  static const String _tokenKey = 'rudraksha_driver_token';
  static const String _sessionKey = 'rudraksha_driver_session';

  static String? _cachedToken;
  static DriverModel? currentDriver;

  static Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _cachedToken = prefs.getString(_tokenKey);
    final rawSession = prefs.getString(_sessionKey);
    if (rawSession != null) {
      try {
        final Map<String, dynamic> json = jsonDecode(rawSession);
        currentDriver = DriverModel.fromJson(json, token: _cachedToken);
        final cleanPhone =
            currentDriver?.phone.replaceAll(RegExp(r'\D'), '') ?? '';
        final savedAvatar =
            prefs.getString('rudraksha_rider_avatar_$cleanPhone');
        if (savedAvatar != null && savedAvatar.isNotEmpty) {
          currentDriver?.avatarUrl = savedAvatar;
        }
      } catch (e) {
        debugPrint('Failed to parse cached session: $e');
      }
    }
  }

  static Map<String, String> _getHeaders() {
    final headers = {'Content-Type': 'application/json'};
    if (_cachedToken != null && _cachedToken!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $_cachedToken';
    }
    return headers;
  }

  // 1. Rider Login
  static Future<Map<String, dynamic>> login(
      String phone, String password) async {
    try {
      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/login');
      final cleanPhone = phone.trim().replaceAll(RegExp(r'\D'), '');
      final cleanPin = password.trim();

      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phone': cleanPhone,
          'pin': cleanPin,
          'password': cleanPin,
        }),
      ).timeout(const Duration(seconds: 15));

      final data = jsonDecode(res.body);

      if (res.statusCode == 200 && data['success'] == true) {
        _cachedToken = data['token'];
        final riderData = data['driver'] ?? data['rider'] ?? {};
        currentDriver = DriverModel.fromJson(riderData, token: _cachedToken);

        final prefs = await SharedPreferences.getInstance();
        if (_cachedToken != null) {
          await prefs.setString(_tokenKey, _cachedToken!);
        }

        // Restore avatar if already saved locally
        final savedAvatar =
            prefs.getString('rudraksha_rider_avatar_$cleanPhone');
        if (savedAvatar != null && savedAvatar.isNotEmpty) {
          currentDriver?.avatarUrl = savedAvatar;
        } else if (currentDriver?.avatarUrl != null &&
            currentDriver!.avatarUrl!.isNotEmpty) {
          await prefs.setString(
              'rudraksha_rider_avatar_$cleanPhone', currentDriver!.avatarUrl!);
        }

        await prefs.setString(_sessionKey, jsonEncode(currentDriver!.toJson()));

        return {'success': true, 'rider': currentDriver};
      } else {
        return {
          'success': false,
          'error': data['error'] ?? 'Login failed. Please check credentials.'
        };
      }
    } catch (e) {
      return {'success': false, 'error': 'Network connection error: $e'};
    }
  }

  // 2. Validate Profile / Me
  static Future<bool> checkAuth() async {
    if (_cachedToken == null || _cachedToken!.isEmpty) return false;
    try {
      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/me');
      final res = await http
          .get(url, headers: _getHeaders())
          .timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (data['success'] == true && data['rider'] != null) {
          final serverDriver =
              DriverModel.fromJson(data['rider'], token: _cachedToken);
          final prefs = await SharedPreferences.getInstance();
          final cleanPhone =
              serverDriver.phone.replaceAll(RegExp(r'\D'), '');
          final savedAvatar =
              prefs.getString('rudraksha_rider_avatar_$cleanPhone');

          if (savedAvatar != null && savedAvatar.isNotEmpty) {
            serverDriver.avatarUrl = savedAvatar;
          } else if (serverDriver.avatarUrl != null &&
              serverDriver.avatarUrl!.isNotEmpty) {
            await prefs.setString(
                'rudraksha_rider_avatar_$cleanPhone', serverDriver.avatarUrl!);
          }

          currentDriver = serverDriver;
          await prefs.setString(_sessionKey, jsonEncode(currentDriver!.toJson()));
          return true;
        }
      }
      return currentDriver != null;
    } catch (e) {
      // Offline fallback: if cached session exists, let user in
      return currentDriver != null;
    }
  }

  // 3. Toggle Duty (Online / Offline)
  static Future<bool> toggleDuty(bool onDuty) async {
    if (currentDriver != null) {
      currentDriver!.onDuty = onDuty;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_sessionKey, jsonEncode(currentDriver!.toJson()));
    }

    try {
      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/duty');
      final res = await http.patch(
        url,
        headers: _getHeaders(),
        body: jsonEncode({'onDuty': onDuty}),
      ).timeout(const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) {
      return true; // Keep local toggle alive
    }
  }

  // 4. Fetch Driver Live Feed (Active Trip & Available Jobs)
  static Future<Map<String, dynamic>> fetchFeed() async {
    try {
      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/jobs');
      final res = await http
          .get(url, headers: _getHeaders())
          .timeout(const Duration(seconds: 6));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);

        OrderModel? activeTrip;
        if (data['activeTrip'] != null) {
          activeTrip = OrderModel.fromJson(data['activeTrip'], isDirect: true);
        }

        final List<OrderModel> availableJobs = [];
        if (data['availableJobs'] != null && data['availableJobs'] is List) {
          for (var item in data['availableJobs']) {
            availableJobs.add(OrderModel.fromJson(item, isDirect: false));
          }
        }

        return {
          'success': true,
          'activeTrip': activeTrip,
          'availableJobs': availableJobs,
        };
      }
      return {'success': false, 'error': 'Server error: ${res.statusCode}'};
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  // 5. Accept Job
  static Future<Map<String, dynamic>> acceptJob(String parcelId) async {
    try {
      final url =
          Uri.parse('${ApiConfig.currentBaseUrl}/rider/jobs/$parcelId/accept');
      final res = await http
          .post(url, headers: _getHeaders())
          .timeout(const Duration(seconds: 8));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        return {'success': true, 'parcel': data['parcel']};
      }
      return {
        'success': false,
        'error': data['error'] ?? 'Could not accept order.'
      };
    } catch (e) {
      return {'success': false, 'error': 'Connection failed: $e'};
    }
  }

  // 5B. Decline Job (Notifies backend and admin)
  static Future<Map<String, dynamic>> declineJob(String parcelId) async {
    try {
      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/jobs/$parcelId/decline');
      final res = await http.post(
        url,
        headers: _getHeaders(),
        body: jsonEncode({'reason': 'Driver declined via app notification'}),
      ).timeout(const Duration(seconds: 8));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        return {'success': true, 'parcel': data['parcel']};
      }
      return {'success': false, 'error': data['error'] ?? 'Could not decline order.'};
    } catch (e) {
      return {'success': false, 'error': 'Connection failed: $e'};
    }
  }

  // 6. Verify Pickup OTP
  static Future<Map<String, dynamic>> verifyPickupOtp(
      String parcelId, String otp) async {
    try {
      final url = Uri.parse(
          '${ApiConfig.currentBaseUrl}/parcels/$parcelId/verify-pickup-otp');
      final res = await http.post(
        url,
        headers: _getHeaders(),
        body: jsonEncode({'otp': otp}),
      ).timeout(const Duration(seconds: 8));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Pickup verified!'
        };
      }
      return {'success': false, 'error': data['error'] ?? 'Invalid Pickup PIN'};
    } catch (e) {
      return {'success': false, 'error': 'Connection failed: $e'};
    }
  }

  // 7. Verify Delivery OTP & Complete Trip
  static Future<Map<String, dynamic>> verifyDeliveryOtp(
      String parcelId, String otp) async {
    try {
      final url = Uri.parse(
          '${ApiConfig.currentBaseUrl}/parcels/$parcelId/verify-delivery-otp');
      final res = await http.post(
        url,
        headers: _getHeaders(),
        body: jsonEncode({'otp': otp}),
      ).timeout(const Duration(seconds: 8));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Trip completed successfully!'
        };
      }
      return {'success': false, 'error': data['error'] ?? 'Invalid Delivery PIN'};
    } catch (e) {
      return {'success': false, 'error': 'Connection failed: $e'};
    }
  }

  // 8. Fetch Rider Earnings
  static Future<Map<String, dynamic>> fetchEarnings() async {
    try {
      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/earnings');
      final res = await http
          .get(url, headers: _getHeaders())
          .timeout(const Duration(seconds: 6));

      if (res.statusCode == 200) {
        return jsonDecode(res.body);
      }
      return {'totalEarnings': 0, 'completedTrips': 0, 'trips': []};
    } catch (_) {
      return {'totalEarnings': 0, 'completedTrips': 0, 'trips': []};
    }
  }

  // 9. Upload Profile Photo / Avatar (Saved to DB + SharedPreferences + Admin Panel)
  static Future<Map<String, dynamic>> uploadAvatar(String base64Image) async {
    try {
      final cleanPhone =
          currentDriver?.phone.replaceAll(RegExp(r'\D'), '') ?? '';
      if (cleanPhone.isEmpty) {
        return {'success': false, 'error': 'Driver phone not found'};
      }

      // Save locally first immediately
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('rudraksha_rider_avatar_$cleanPhone', base64Image);
      if (currentDriver != null) {
        currentDriver!.avatarUrl = base64Image;
        await prefs.setString(_sessionKey, jsonEncode(currentDriver!.toJson()));
      }

      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/avatar');
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phone': cleanPhone,
          'avatar_url': base64Image,
        }),
      ).timeout(const Duration(seconds: 15));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        final cloudUrl = data['avatar_url'] ?? base64Image;
        if (currentDriver != null) {
          currentDriver!.avatarUrl = cloudUrl;
          await prefs.setString('rudraksha_rider_avatar_$cleanPhone', cloudUrl);
          await prefs.setString(
              _sessionKey, jsonEncode(currentDriver!.toJson()));
        }
        return {'success': true, 'avatar_url': cloudUrl};
      }
      return {'success': true, 'avatar_url': base64Image};
    } catch (e) {
      return {'success': true, 'avatar_url': base64Image, 'offline': true};
    }
  }

  // 10. Remove Profile Photo
  static Future<bool> removeAvatar() async {
    try {
      final cleanPhone =
          currentDriver?.phone.replaceAll(RegExp(r'\D'), '') ?? '';
      final prefs = await SharedPreferences.getInstance();
      if (cleanPhone.isNotEmpty) {
        await prefs.remove('rudraksha_rider_avatar_$cleanPhone');
      }
      if (currentDriver != null) {
        currentDriver!.avatarUrl = null;
        await prefs.setString(_sessionKey, jsonEncode(currentDriver!.toJson()));
      }

      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/avatar');
      await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phone': cleanPhone,
          'avatar_url': 'REMOVE',
        }),
      ).timeout(const Duration(seconds: 8));

      return true;
    } catch (_) {
      return true;
    }
  }

  // 11. Send Live GPS Location
  static Future<bool> sendLocation({
    required double latitude,
    required double longitude,
    double? speed,
    double? heading,
    double? accuracy,
  }) async {
    try {
      if (_cachedToken == null) return false;

      final url = Uri.parse('${ApiConfig.currentBaseUrl}/rider/location');
      final res = await http.post(
        url,
        headers: _getHeaders(),
        body: jsonEncode({
          'latitude': latitude,
          'longitude': longitude,
          'speed': speed ?? 0,
          'heading': heading ?? 0,
          'accuracy': accuracy ?? 0,
        }),
      ).timeout(const Duration(seconds: 8));

      return res.statusCode == 200;
    } catch (e) {
      debugPrint('Error sending location: $e');
      return false;
    }
  }

  // Logout
  static Future<void> logout() async {
    _cachedToken = null;
    currentDriver = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_sessionKey);
  }
}

