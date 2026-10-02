import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart'
    hide NotificationVisibility;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:vibration/vibration.dart';
import '../models/order_model.dart';

class AlertManager {
  static final AlertManager _instance = AlertManager._internal();
  factory AlertManager() => _instance;
  AlertManager._internal();

  final AudioPlayer _audioPlayer = AudioPlayer();
  final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();

  bool _isPlaying = false;
  Timer? _vibrateTimer;

  static Function(String action, String? parcelId)? onActionCallback;

  static const String channelId = 'rudraksha_rider_dispatch_v3';
  static const String channelName = 'Direct Order Dispatch & Siren Alerts';
  static const String channelDesc =
      'High-priority sound alerts and vibrating alarms for assigned jobs';

  Future<void> init() async {
    try {
      const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
      const initSettings = InitializationSettings(android: androidInit);

      await _notificationsPlugin.initialize(
        initSettings,
        onDidReceiveNotificationResponse: (NotificationResponse details) {
          debugPrint('Dispatch notification action: ${details.actionId}, payload: ${details.payload}');
          if (details.actionId == 'silence_order') {
            muteSound();
            onActionCallback?.call('silent', details.payload);
          } else if (details.actionId == 'decline_order') {
            stopAlert(notifId: details.payload?.hashCode);
            onActionCallback?.call('decline', details.payload);
          } else if (details.actionId == 'accept_order') {
            stopAlert(notifId: details.payload?.hashCode);
            onActionCallback?.call('accept', details.payload);
            FlutterForegroundTask.launchApp();
          } else {
            // Tapping notification body mutes sound and brings app to foreground
            muteSound();
            FlutterForegroundTask.launchApp();
          }
        },
      );

      // Create Android Notification Channel with MAXIMUM importance & sound
      final androidChannel = AndroidNotificationChannel(
        channelId,
        channelName,
        description: channelDesc,
        importance: Importance.max,
        enableVibration: true,
        playSound: true,
        showBadge: true,
      );

      await _notificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(androidChannel);

      // Configure Audio Player to play on ALARM stream
      try {
        await _audioPlayer.setAudioContext(
          AudioContext(
            android: const AudioContextAndroid(
              isSpeakerphoneOn: true,
              stayAwake: true,
              contentType: AndroidContentType.sonification,
              usageType: AndroidUsageType.alarm,
              audioFocus: AndroidAudioFocus.gainTransientExclusive,
            ),
          ),
        );
      } catch (audioCtxErr) {
        debugPrint('AudioContext configuration warning: $audioCtxErr');
      }
    } catch (e) {
      debugPrint('AlertManager init error: $e');
    }
  }

  Future<void> triggerNewOrderAlert(OrderModel order) async {
    if (_isPlaying) return; // Prevent duplicate overlapping alert loops
    _isPlaying = true;

    // Wake screen and display on lock screen immediately
    try {
      FlutterForegroundTask.wakeUpScreen();
      FlutterForegroundTask.setOnLockScreenVisibility(true);
    } catch (_) {}

    // 1. Play Tone Once through Alarm Channel with soft, non-irritating volume
    try {
      await _audioPlayer.setReleaseMode(ReleaseMode.release);
      await _audioPlayer.setVolume(0.4);
      await _audioPlayer.play(AssetSource('siren.wav'));
    } catch (e) {
      debugPrint('Audio play error: $e');
    }

    // 2. Start Heavy Mobile Vibration Pattern
    _startContinuousVibration();

    // 3. Fire Native Android Lock Screen Notification (Heads-Up Banner)
    try {
      final isDirect = order.isDirectAssignment;
      final title = isDirect
          ? '🚨 NAYA ORDER ASSIGN HUA! (₹${order.totalAmount.toInt()})'
          : '⚡ NAYA PARCEL ORDER AVAILABLE! (₹${order.totalAmount.toInt()})';
      final body =
          '📍 Pickup: ${order.pickupAddress}\n🏁 Drop: ${order.dropAddress}\nTap ACCEPT ya DECLINE karein!';

      final androidDetails = AndroidNotificationDetails(
        channelId,
        channelName,
        channelDescription: channelDesc,
        importance: Importance.max,
        priority: Priority.max,
        fullScreenIntent: true,
        enableVibration: true,
        playSound: true,
        vibrationPattern: Int64List.fromList([0, 800, 300, 800, 300, 1000]),
        category: AndroidNotificationCategory.call,
        visibility: NotificationVisibility.public,
        ongoing: true,
        autoCancel: false,
        actions: const [
          AndroidNotificationAction(
            'silence_order',
            '🔇 SILENCE / MUTE',
            showsUserInterface: false,
            cancelNotification: false,
          ),
          AndroidNotificationAction(
            'accept_order',
            '✅ ACCEPT',
            showsUserInterface: true,
            cancelNotification: true,
          ),
          AndroidNotificationAction(
            'decline_order',
            '❌ DECLINE',
            showsUserInterface: false,
            cancelNotification: true,
          ),
        ],
      );

      final notifDetails = NotificationDetails(android: androidDetails);

      await _notificationsPlugin.show(
        order.parcelId.hashCode,
        title,
        body,
        notifDetails,
        payload: order.parcelId,
      );
    } catch (e) {
      debugPrint('Notification show error: $e');
    }
  }

  void _startContinuousVibration() {
    _vibrateTimer?.cancel();
    _triggerVibrateOnce();

    _vibrateTimer = Timer.periodic(const Duration(milliseconds: 2200), (timer) {
      if (!_isPlaying) {
        timer.cancel();
        return;
      }
      _triggerVibrateOnce();
    });
  }

  void _triggerVibrateOnce() async {
    try {
      final hasVibrator = await Vibration.hasVibrator();
      if (hasVibrator == true) {
        Vibration.vibrate(
          pattern: [0, 800, 300, 800, 300, 1000],
          intensities: [0, 255, 0, 255, 0, 255],
        );
      }
    } catch (e) {
      debugPrint('Vibration error: $e');
    }
  }

  /// Instantly stops audio and vibration without dismissing the order
  Future<void> muteSound() async {
    _isPlaying = false;
    _vibrateTimer?.cancel();
    _vibrateTimer = null;
    try {
      await _audioPlayer.stop();
    } catch (e) {
      debugPrint('Audio stop error: $e');
    }
    try {
      await Vibration.cancel();
    } catch (e) {
      debugPrint('Vibration cancel error: $e');
    }
  }

  /// Completely stops alert and dismisses notification
  Future<void> stopAlert({int? notifId}) async {
    await muteSound();
    try {
      if (notifId != null) {
        await _notificationsPlugin.cancel(notifId);
      } else {
        await _notificationsPlugin.cancelAll();
      }
    } catch (e) {
      debugPrint('Notification cancel error: $e');
    }
  }
}
