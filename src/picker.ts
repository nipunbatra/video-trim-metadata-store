import { CONFIG } from './config';
import { loadScript } from './auth';

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PickedFolder {
  id: string;
  name: string;
}

let pickerReady: Promise<void> | null = null;

function initPicker(): Promise<void> {
  if (!pickerReady) {
    pickerReady = loadScript('https://apis.google.com/js/api.js').then(
      () => new Promise<void>((resolve) => gapi.load('picker', () => resolve())),
    );
  }
  return pickerReady;
}

function basePicker(token: string) {
  return new google.picker.PickerBuilder()
    .setOAuthToken(token)
    .setDeveloperKey(CONFIG.API_KEY)
    .setAppId(CONFIG.APP_ID) // required so drive.file grants access to picks
    .enableFeature(google.picker.Feature.SUPPORT_DRIVES);
}

export async function pickVideo(token: string): Promise<PickedFile | null> {
  await initPicker();
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS_VIDEOS)
      .setIncludeFolders(true);
    const picker = basePicker(token)
      .addView(view)
      .setTitle('Pick a video to trim')
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const d = data.docs[0];
          resolve({
            id: d.id,
            name: d.name,
            mimeType: d.mimeType,
            sizeBytes: Number(d.sizeBytes ?? 0),
          });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

export async function pickFolder(token: string): Promise<PickedFolder | null> {
  await initPicker();
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    const picker = basePicker(token)
      .addView(view)
      .setTitle('Choose destination folder')
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const d = data.docs[0];
          resolve({ id: d.id, name: d.name });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
