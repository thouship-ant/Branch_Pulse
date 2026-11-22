// Adds the Firebase file to the Android build when it is there: put google-services.json (from the Firebase console, package
// pro.antstockpulse.branchpulse) next to app.json, or on EAS set the file variable GOOGLE_SERVICES_JSON. Without it the app cannot
// get a push token on Android ("Default FirebaseApp is not initialized"). Everything else stays in app.json.
const fs = require('node:fs');

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);
  if (!file) return config;
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
