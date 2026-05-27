/**
 * Terminal Output Monitor — watches for error patterns in terminal output.
 * Called from GenesisShell when terminal data arrives.
 * Detects: vite not found, module not found, syntax errors, build failures, etc.
 */

const ERROR_PATTERNS = [
  /ERR!/,                    // npm ERR!
  /Cannot find module/i,
  /Module not found/i,
  /vite not found/i,
  /command not found/i,
  /ENOENT/i,
  /SyntaxError/i,
  /Unexpected token/i,
  /failed to compile/i,
  /Build failed/i,
  /sh: .* not found/i,
  /EADDRINUSE/i,
  /EPERM/i,
  /TypeError/i,
  /ReferenceError/i,
  /is not defined/i,
  /is not a function/i,
  /Cannot read properties/i,
];

const IGNORE_PATTERNS = [
  /npm warn/i,
  /warning/i,
  /deprecated/i,
  /added .* packages/i,
  /removed .* packages/i,
  /up to date/i,
  /audited/i,
  /vite v/i,              // "VITE v5.4.2 ready in" — NOT an error
  /ready in/i,             // "ready in 234ms"
  /Local:/i,               // "Local: http://localhost:5173/"
  /Network:/i,
  /press/i,                // "press h + enter to show help"
];

let _lastErrorTime = 0;
const ERROR_DEBOUNCE = 3000; // Don't report same error within 3s

export function monitorTerminalOutput(data: string) {
  const clean = data.replace(/\x1b\[[0-9;]*[mGKHJ]/g, '').trim();
  if (!clean || clean.length < 10) return;

  const isError = ERROR_PATTERNS.some(p => p.test(clean));
  const isIgnored = IGNORE_PATTERNS.some(p => p.test(clean));

  if (isError && !isIgnored) {
    // Debounce — don't spam the same error
    const now = Date.now();
    if (now - _lastErrorTime < ERROR_DEBOUNCE) return;
    _lastErrorTime = now;

    import('~/lib/stores/preview-error-fixer').then(({ previewErrorFixer }) => {
      previewErrorFixer.addTerminalError({
        command: 'dev-server',
        output: clean,
        exitCode: 1,
        timestamp: Date.now(),
      });
      console.log('[TerminalMonitor] Error detected:', clean.substring(0, 100));
    }).catch(() => {});
  }
}
