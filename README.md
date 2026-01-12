# demCalendar (Demo)

Portfolio-ready demo of a tours agency calendar app. It showcases scheduling, guide assignments, vendor costs, and invoice workflows using Firebase + Google Apps Script.

## Live Demo
- URL: https://demcalendar-a9010.web.app
- Manager: demo.manager@demcalendar.app / Demo2026!
- Guide: demo.guide@demcalendar.app / Demo2026!

## Highlights
- Manager dashboard with calendar assignments and guide management
- Vendor costs and monthly invoice generation
- Guide portal with assignments and invoice uploads
- Email notifications via Brevo
- Dark/light theme toggle and i18n switch

## Stack
- Frontend: HTML, Tailwind (CDN), vanilla JS
- Backend: Firebase Auth, Firestore, Cloud Functions (Node 20)
- Integrations: Google Apps Script (Calendar/Drive/Sheets)
- Hosting: Firebase Hosting

## Local Setup
1. Install Node 20 and Firebase CLI.
2. Install deps:
   - `npm install`
   - `cd functions && npm install`
3. Select Firebase project:
   - `firebase use --add`
4. Set secrets (Functions):
   - `firebase functions:secrets:set APPS_SCRIPT_URL`
   - `firebase functions:secrets:set APPS_SCRIPT_API_KEY`
   - `firebase functions:secrets:set BREVO_API_KEY`
5. Run locally (optional):
   - `firebase emulators:start`
6. Deploy:
   - `firebase deploy`

## Notes
- Public demo only. No real personal or sensitive data is stored.
- Some flows require Apps Script endpoints and shared Drive folders.

## Contact
- Email: leadtoshopsl@gmail.com
- GitHub: https://github.com/DemFlax
