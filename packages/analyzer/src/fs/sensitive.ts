/**
 * Files that may hold secrets. They are listed as excluded and never read,
 * hashed, parsed or sent anywhere.
 */
const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'key.properties',
  'local.properties',
  'keystore.properties',
  'secrets.properties',
  'google-services.json',
  'googleservice-info.plist',
  'credentials.json',
  'service-account.json',
  'id_rsa',
  'id_ed25519',
  '.git-credentials',
]);

const SENSITIVE_EXTENSIONS = [
  '.jks',
  '.keystore',
  '.p12',
  '.pfx',
  '.pem',
  '.key',
  '.p8',
  '.cer',
  '.crt',
  '.der',
  '.mobileprovision',
  '.provisionprofile',
  '.certSigningRequest',
].map((e) => e.toLowerCase());

/** True when the file name looks like it may contain credentials or signing material. */
export function isSensitiveFile(fileName: string): boolean {
  const name = fileName.toLowerCase();
  if (SENSITIVE_FILE_NAMES.has(name)) return true;
  if (name.startsWith('.env.') || name.endsWith('.env')) return true;
  if (/^secrets?\./.test(name)) return true;
  return SENSITIVE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Directories never scanned: dependencies, build output, tooling caches, VCS metadata. */
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'build',
  'dist',
  'out',
  '.dart_tool',
  '.pub-cache',
  '.gradle',
  '.idea',
  '.vscode',
  '.cxx',
  '.externalNativeBuild',
  'Pods',
  'DerivedData',
  'xcuserdata',
  '.symlinks',
  'ephemeral',
  '.expo',
  '.next',
  'coverage',
  '__pycache__',
  '.fvm',
]);

export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

/** Vendored dependency trees identified by their path, e.g. Bundler's `vendor/bundle` (fastlane gems). */
const IGNORED_PATHS = /(^|\/)(vendor\/bundle|vendor\/cache|\.bundle|Carthage\/Checkouts|Carthage\/Build|\.swiftpm|SourcePackages)$/;

export function isIgnoredPath(relDir: string): boolean {
  return IGNORED_PATHS.test(relDir);
}
