# OM Rudraksha Driver - Google Play Store Release & Keystore Reference

This document stores the official production signing credentials and update workflow for the **OM Rudraksha Driver** app on the Google Play Store.

---

## 🔐 1. Official Release Keystore Credentials

> **CRITICAL:** Do NOT lose this file or password. Google Play will reject any future app updates if they are signed with a different key!

- **Keystore File Location:** `driver_app/android/app/upload-keystore.jks`
- **Key Properties File:** `driver_app/android/key.properties`
- **Key Alias:** `upload`
- **Store Password:** `Rudraksha@2026Driver`
- **Key Password:** `Rudraksha@2026Driver`
- **Keystore Type:** `PKCS12` (Industry Standard)
- **Certificate Validity:** 10,000 Days (~27 Years)
- **Certificate Owner:** `CN=OM Rudraksha Logistics, OU=Mobile, O=OM Rudraksha Packers and Movers, L=Jaipur, ST=Rajasthan, C=IN`

---

## 📦 2. Play Store Release File Location

- **Current Production AAB:** `playstore_release/OM_Rudraksha_Driver_v1.3.1_release.aab`
- **Flutter Build Path:** `driver_app/build/app/outputs/bundle/release/app-release.aab`
- **Package Name (Application ID):** `com.rudraksha.driver_app`
- **Initial Version:** `1.3.1` (Version Code `13`)

---

## 🚀 3. How New Updates Work on Google Play Store

Whenever you want to release a new update in the future:

1. **Ask Antigravity (AI):**  
   Bas mujhe bolo *"bhai naya update nikaal do"* ya feature add karne ke baad *"Play Store ke liye naya bundle bana do"*.

2. **Automated Version Bump & Build:**
   Antigravity will:
   - Increment version in `pubspec.yaml` (e.g., `1.3.1+13` ➔ `1.3.2+14`).
   - Run `flutter build appbundle --release` (automatically signed with `upload-keystore.jks`).
   - Copy the ready file to `playstore_release/OM_Rudraksha_Driver_v1.3.2_release.aab`.

3. **1-Minute Upload in Google Play Console:**
   - Go to **Google Play Console ➔ Production (or Closed testing)**.
   - Click **Create new release**.
   - Drag and drop the new `.aab` file.
   - Write 1 line in Release Notes (e.g., `Bug fixes & performance improvements`).
   - Click **Save & Rollout**.

4. **Automatic User Delivery:**
   - Google automatically distributes the update to all drivers' Android phones.
   - Drivers don't have to download manual APKs or allow "Unknown Sources".
   - Updates download automatically in the background via Google Play.

