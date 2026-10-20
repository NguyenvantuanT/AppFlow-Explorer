import type { UiStateRule } from '../core/uiStates';

/*
 * UI-state patterns per framework. A match means the screen's code handles
 * the state; it does not prove the state is reachable at runtime, so
 * confidence stays below `high` unless the pattern is unambiguous.
 */

export const FLUTTER_UI_STATES: UiStateRule[] = [
  { kind: 'auth', label: 'Authentication', pattern: /\b(isLoggedIn|isSignedIn|isAuthenticated|currentUser|authState\w*|AuthService|AuthRepository|FirebaseAuth|SessionManager)\b/, confidence: 'medium' },
  { kind: 'data', label: 'Loads data', pattern: /\b(FutureBuilder|StreamBuilder|BlocBuilder|BlocConsumer|AsyncValue|RefreshIndicator)\b|\.when\(\s*data:|\bhttp\.(get|post|put|patch|delete)\b|\b_?(dio|api|client|repository|service)\.\w+\(/, confidence: 'medium' },
  { kind: 'loading', label: 'Loading', pattern: /\b(CircularProgressIndicator|LinearProgressIndicator|CupertinoActivityIndicator|Shimmer)\b|ConnectionState\.waiting|\b_?is(Loading|Busy|Submitting)\b|\bloading:\s*\(/, confidence: 'high' },
  { kind: 'empty', label: 'Empty', pattern: /\.isEmpty\b|\.length\s*==\s*0|\bEmpty\w*(View|Widget|State)\b|['"](No |Nothing )\w/, confidence: 'medium' },
  { kind: 'error', label: 'Error', pattern: /\.hasError\b|\berror:\s*\(|\bonError\b|\bErrorWidget\b|\bcatch\s*\(|\bon\s+\w*(Exception|Error)\b|\b_?error(Message|Text)?\s*!=\s*null/, confidence: 'medium' },
  { kind: 'dialog', label: 'Dialog', pattern: /\b(showDialog|showCupertinoDialog|showGeneralDialog|showAdaptiveDialog|showAboutDialog|showDatePicker|showTimePicker)\b/, confidence: 'high' },
  { kind: 'bottomSheet', label: 'Bottom sheet', pattern: /\b(showModalBottomSheet|showCupertinoModalPopup|showBottomSheet|showMaterialModalBottomSheet|showBarModalBottomSheet|showCupertinoModalBottomSheet)\b/, confidence: 'high' },
  { kind: 'tabs', label: 'Tabs', pattern: /\b(BottomNavigationBar|NavigationBar|TabBar|TabBarView|CupertinoTabScaffold|CupertinoTabBar|DefaultTabController|NavigationRail|AutoTabsScaffold|AutoTabsRouter)\b/, confidence: 'high' },
];

export const ANDROID_UI_STATES: UiStateRule[] = [
  { kind: 'auth', label: 'Authentication', pattern: /\b(isLoggedIn|isSignedIn|isAuthenticated|currentUser|FirebaseAuth|AuthRepository|SessionManager)\b/, confidence: 'medium' },
  { kind: 'data', label: 'Loads data', pattern: /\b(viewModelScope|lifecycleScope|collectAsState\w*|LiveData|StateFlow|repository\.\w+|Retrofit|enqueue)\b|\.observe\(/, confidence: 'medium' },
  { kind: 'loading', label: 'Loading', pattern: /\b(ProgressBar|CircularProgressIndicator|LinearProgressIndicator|SwipeRefreshLayout|PullToRefreshBox|isLoading|ShimmerFrameLayout)\b/, confidence: 'high' },
  { kind: 'empty', label: 'Empty', pattern: /\.isEmpty\(\)|\.isEmpty\b|\bemptyView\b|\bEmpty\w*(View|State)\b/, confidence: 'medium' },
  { kind: 'error', label: 'Error', pattern: /\bcatch\s*\(|\bonFailure\b|\bResult\.(Error|Failure)\b|\bis(Error|Failure)\b|\berrorMessage\b|\bSnackbar\.make\b/, confidence: 'medium' },
  { kind: 'dialog', label: 'Dialog', pattern: /\b(AlertDialog|DialogFragment|MaterialAlertDialogBuilder|DatePickerDialog|TimePickerDialog)\b/, confidence: 'high' },
  { kind: 'bottomSheet', label: 'Bottom sheet', pattern: /\b(BottomSheetDialog\w*|ModalBottomSheet|BottomSheetScaffold)\b/, confidence: 'high' },
  { kind: 'tabs', label: 'Tabs', pattern: /\b(TabLayout|BottomNavigationView|NavigationBar|TabRow|ScrollableTabRow|ViewPager2?|NavigationRail)\b/, confidence: 'high' },
];

export const IOS_UI_STATES: UiStateRule[] = [
  { kind: 'auth', label: 'Authentication', pattern: /\b(isLoggedIn|isSignedIn|isAuthenticated|currentUser|Auth\.auth|AuthService|SessionManager)\b/, confidence: 'medium' },
  { kind: 'data', label: 'Loads data', pattern: /\b(URLSession|AsyncImage|@FetchRequest|@Query|async let)\b|\.task\s*\{|\.refreshable\b|\bawait\s+\w/, confidence: 'medium' },
  { kind: 'loading', label: 'Loading', pattern: /\b(ProgressView|UIActivityIndicatorView|UIRefreshControl|isLoading)\b/, confidence: 'high' },
  { kind: 'empty', label: 'Empty', pattern: /\.isEmpty\b|\bContentUnavailableView\b|\bEmpty\w*(View|State)\b/, confidence: 'medium' },
  { kind: 'error', label: 'Error', pattern: /\bcatch\b|\.failure\b|\berrorMessage\b|\bError\w*View\b/, confidence: 'medium' },
  { kind: 'dialog', label: 'Dialog', pattern: /\.alert\(|\bUIAlertController\b|\.confirmationDialog\(/, confidence: 'high' },
  { kind: 'bottomSheet', label: 'Bottom sheet', pattern: /\.presentationDetents\(|\bUISheetPresentationController\b|\.sheetPresentationController\b/, confidence: 'high' },
  { kind: 'tabs', label: 'Tabs', pattern: /\b(TabView|UITabBarController|UITabBar|UISegmentedControl)\b/, confidence: 'high' },
];

export const REACT_NATIVE_UI_STATES: UiStateRule[] = [
  { kind: 'auth', label: 'Authentication', pattern: /\b(useAuth|isLoggedIn|isSignedIn|isAuthenticated|currentUser|AuthContext|useSession)\b/, confidence: 'medium' },
  { kind: 'data', label: 'Loads data', pattern: /\b(fetch|axios(\.\w+)?|useQuery|useInfiniteQuery|useSWR|useFetch|RefreshControl)\s*\(|\bRefreshControl\b/, confidence: 'medium' },
  { kind: 'loading', label: 'Loading', pattern: /\b(ActivityIndicator|isLoading|isFetching|SkeletonPlaceholder)\b/, confidence: 'high' },
  { kind: 'empty', label: 'Empty', pattern: /\bListEmptyComponent\b|\.length\s*===?\s*0|\bEmpty\w*(View|State)\b/, confidence: 'medium' },
  { kind: 'error', label: 'Error', pattern: /\bcatch\s*\(|\.catch\(|\bisError\b|\berror\s*&&|\bonError\b|\bErrorBoundary\b/, confidence: 'medium' },
  { kind: 'dialog', label: 'Dialog', pattern: /\bAlert\.(alert|prompt)\(|<Modal\b/, confidence: 'high' },
  { kind: 'bottomSheet', label: 'Bottom sheet', pattern: /\b(BottomSheet\w*|ActionSheetIOS|showActionSheetWithOptions)\b/, confidence: 'high' },
  { kind: 'tabs', label: 'Tabs', pattern: /\b(createBottomTabNavigator|createMaterialTopTabNavigator|Tab\.Navigator|TabView|Tabs)\b/, confidence: 'high' },
];
