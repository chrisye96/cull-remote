import { readChoice, QUALITIES } from './prefs.js';
import { sizeFor } from './state.js';

export const HD_QUERY = matchMedia('(min-width: 768px) and (min-height: 600px)');

// The preview size to request: the setting, or the screen when the setting is automatic.
export const previewSize = () => sizeFor(readChoice('quality', QUALITIES, 'auto'), HD_QUERY.matches);
