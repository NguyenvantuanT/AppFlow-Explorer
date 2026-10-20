export { analyzeProject, languageOf, type AnalysisProgress, type AnalysisPhase, type AnalysisResult, type AnalyzeOptions } from './core/engine';
export type { AnalysisAdapter, Capability, CapabilityKind, DetectionMatch, Limitation } from './core/types';
export { ProjectGraphBuilder } from './core/builder';
export { CodeIndex } from './core/codeIndex';
export { ProjectFs, AccessDeniedError } from './fs/projectFs';
export { isSensitiveFile } from './fs/sensitive';
export { defaultAdapters } from './adapters';
