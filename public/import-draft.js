import { parseFen } from './vendor/xiangqi.js';

const KEY = 'qili-import-draft-v1';
const fields = ['fen','inputFen','turn','brush','orientation','maxMoves','confirmed','playback','report','explanation','image','imageName','corners'];
const omitCredentials = (key, value) => /^(apiKey|modelSettings|authorization|headers|accessToken|token)$/i.test(key) ? undefined : value;

// This tab's work can survive reload. Model credentials stay in page memory.
export function createImportDraftStore(storageProvider = () => window.sessionStorage) {
  return {
    save(snapshot) {
      const draft = {version:1};
      for (const key of fields) if (snapshot[key] !== undefined) draft[key] = snapshot[key];
      try {
        parseFen(draft.fen);
        const storage = storageProvider();
        try {
          storage.setItem(KEY, JSON.stringify(draft, omitCredentials)); return 'full';
        } catch {
          storage.setItem(KEY, JSON.stringify({...draft, report:null, explanation:null, image:null, corners:null}, omitCredentials)); return 'position-only';
        }
      } catch { return false; }
    },
    load() {
      try {
        const raw = storageProvider().getItem(KEY);
        if (!raw || raw.length > 6000000) return null;
        const draft = JSON.parse(raw);
        if (draft?.version !== 1 || typeof draft.fen !== 'string' || draft.fen.length > 220) return null;
        parseFen(draft.fen);
        if (draft.image && (typeof draft.image !== 'string' || draft.image.length > 2000000 || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(draft.image))) draft.image = null;
        return draft;
      } catch { return null; }
    }
  };
}
