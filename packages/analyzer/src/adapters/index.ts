import type { AnalysisAdapter } from '../core/types';
import { androidAdapter } from './android';
import { flutterAdapter } from './flutter';
import { iosAdapter } from './ios';
import { reactNativeAdapter } from './reactNative';

/** All built-in adapters. Order does not matter; the engine orders matches by platform. */
export const defaultAdapters: AnalysisAdapter[] = [flutterAdapter, reactNativeAdapter, androidAdapter, iosAdapter];

export { androidAdapter, flutterAdapter, iosAdapter, reactNativeAdapter };
