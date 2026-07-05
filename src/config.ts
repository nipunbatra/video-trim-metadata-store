// Google Cloud project credentials. These are public by design:
// - the OAuth client only issues tokens to the origins registered below
// - the API key is referrer-restricted to those same origins
export const CONFIG = {
  CLIENT_ID: '754571415429-dve19qtjfntr104sk8a70tb4rt79mgsc.apps.googleusercontent.com',
  API_KEY: '__PASTE_AIza_KEY_HERE__',
  // Cloud project number; required by the Picker so that files the user
  // picks become accessible under the drive.file scope.
  APP_ID: '754571415429',
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
};
