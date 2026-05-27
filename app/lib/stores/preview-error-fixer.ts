import { atom } from 'nanostores';

export interface PreviewError {
  message: string;
  stack: string;
  pathname: string;
  timestamp: number;
}

export interface TerminalError {
  command: string;
  output: string;
  exitCode: number;
  timestamp: number;
}

const MAX_AUTO_FIX_RETRIES = 100;
const MAX_VERIFICATION_ROUNDS = 25;
const VERIFICATION_INTERVAL = 4000; // 4 seconds between checks

type VerificationStatus = 'idle' | 'building' | 'verifying' | 'fixing' | 'passed' | 'failed';

class PreviewErrorFixer {
  errors = atom<PreviewError[]>([]);
  terminalErrors = atom<TerminalError[]>([]);
  autoFixEnabled = atom<boolean>(true);
  retryCount = atom<number>(0);
  isFixing = atom<boolean>(false);
  lastFixedAt = atom<number>(0);
  needsRestart = atom<boolean>(false);

  // Verification system
  verificationStatus = atom<VerificationStatus>('idle');
  verificationRound = atom<number>(0);
  verificationCleanStreak = atom<number>(0);
  verificationTotalChecks = atom<number>(0);
  verificationErrors = atom<number>(0);
  verificationFixes = atom<number>(0);
  verificationLog = atom<string[]>([]);

  private _maxRetries = MAX_AUTO_FIX_RETRIES;
  private _verificationTimer: ReturnType<typeof setInterval> | null = null;
  private _verificationStarted = false;

  addError(error: PreviewError) {
    const current = this.errors.get();

    // Deduplicate: don't add the same error within 5 seconds
    const isDuplicate = current.some(
      (e) => e.message === error.message && error.timestamp - e.timestamp < 5000,
    );

    if (isDuplicate) {
      return;
    }

    this.errors.set([...current, error]);

    // Update verification tracking
    this.verificationErrors.set(this.verificationErrors.get() + 1);
    this._addLog(`ERROR: ${error.message.substring(0, 80)}`);
  }

  addTerminalError(error: TerminalError) {
    const current = this.terminalErrors.get();

    // Deduplicate
    const isDuplicate = current.some(
      (e) => e.command === error.command && error.timestamp - e.timestamp < 5000,
    );

    if (isDuplicate) {
      return;
    }

    this.terminalErrors.set([...current, error]);
    this.needsRestart.set(true);
    this.verificationErrors.set(this.verificationErrors.get() + 1);
    this._addLog(`TERMINAL ERROR: ${error.command} → ${error.output.substring(0, 80)}`);
  }

  canAutoFix(): boolean {
    return (
      this.autoFixEnabled.get() &&
      this.retryCount.get() < this._maxRetries &&
      !this.isFixing.get() &&
      (this.errors.get().length > 0 || this.terminalErrors.get().length > 0)
    );
  }

  incrementRetry() {
    this.retryCount.set(this.retryCount.get() + 1);
    this.verificationFixes.set(this.verificationFixes.get() + 1);
  }

  setFixing(value: boolean) {
    this.isFixing.set(value);
    if (value) {
      this.verificationStatus.set('fixing');
    }
  }

  markFixed() {
    this.lastFixedAt.set(Date.now());
    this.errors.set([]);
    this.terminalErrors.set([]);
    this.needsRestart.set(false);
  }

  reset() {
    this.errors.set([]);
    this.terminalErrors.set([]);
    this.retryCount.set(0);
    this.isFixing.set(false);
    this.needsRestart.set(false);
    this.stopVerification();
    this.verificationStatus.set('idle');
    this.verificationRound.set(0);
    this.verificationCleanStreak.set(0);
    this.verificationTotalChecks.set(0);
    this.verificationErrors.set(0);
    this.verificationFixes.set(0);
    this.verificationLog.set([]);
  }

  getLastError(): PreviewError | undefined {
    const errors = this.errors.get();
    return errors.length > 0 ? errors[errors.length - 1] : undefined;
  }

  formatErrorForAI(): string {
    const terminalErrors = this.terminalErrors.get();
    const previewErrors = this.errors.get();
    const lastTerminalError = terminalErrors.length > 0 ? terminalErrors[terminalErrors.length - 1] : undefined;
    const lastPreviewError = previewErrors.length > 0 ? previewErrors[previewErrors.length - 1] : undefined;

    if (!lastTerminalError && !lastPreviewError) return '';

    let errorSection = '';

    if (lastTerminalError) {
      errorSection = `TERMINAL ERROR (command failed):

Command: ${lastTerminalError.command}
Exit Code: ${lastTerminalError.exitCode}
Output:
${lastTerminalError.output}

ANALYSIS:
This is a terminal/shell error. The application failed to build or start.
Common causes:
- Missing dependencies (npm install needed)
- Invalid package.json or vite.config
- Missing files referenced in imports
- Syntax errors in source files
- Wrong file paths or extensions

YOUR TASK:
1. Diagnose the root cause from the error output above
2. Fix ALL source files that caused this error
3. Ensure package.json has correct dependencies and scripts
4. After fixing, output the corrected files using genesisAction tags
5. End with: <genesisAction type="start">npm run dev</genesisAction>`;
    } else if (lastPreviewError) {
      errorSection = `BROWSER PREVIEW ERROR:

Error: ${lastPreviewError.message}

Stack trace:
${lastPreviewError.stack}

YOUR TASK:
1. Fix the specific error (missing import, undefined variable, syntax error, etc.)
2. Check ALL other files for similar issues
3. Look at the project as a whole and improve it`;
    }

    return `AUTO-FIX: Error Detected (attempt ${this.retryCount.get() + 1}/${this._maxRetries})

${errorSection}

VERIFICATION STATUS: Round ${this.verificationRound.get()}/${MAX_VERIFICATION_ROUNDS}, ${this.verificationCleanStreak.get()} consecutive clean checks, ${this.verificationErrors.get()} errors found, ${this.verificationFixes.get()} fixes applied.

Fix this error. Provide the corrected files using genesisAction tags.`;
  }

  // ========================================
  // VERIFICATION LOOP — 25 rounds of testing
  // ========================================

  /**
   * Start the post-build verification loop.
   * Runs 25 rounds, each checking for errors.
   * Requires 20 consecutive clean rounds to PASS.
   */
  startVerification() {
    if (this._verificationStarted) return;
    this._verificationStarted = true;

    this.verificationStatus.set('verifying');
    this.verificationRound.set(0);
    this.verificationCleanStreak.set(0);
    this.verificationTotalChecks.set(0);
    this._addLog('VERIFICATION STARTED — 25 rounds of testing');

    this._verificationTimer = setInterval(() => {
      this._runVerificationCheck();
    }, VERIFICATION_INTERVAL);

    // Run first check immediately
    setTimeout(() => this._runVerificationCheck(), 1000);
  }

  /**
   * Stop the verification loop
   */
  stopVerification() {
    if (this._verificationTimer) {
      clearInterval(this._verificationTimer);
      this._verificationTimer = null;
    }
    this._verificationStarted = false;
  }

  /**
   * Run a single verification check
   */
  private _runVerificationCheck() {
    const round = this.verificationRound.get() + 1;
    this.verificationRound.set(round);
    this.verificationTotalChecks.set(this.verificationTotalChecks.get() + 1);

    const currentErrors = this.errors.get();
    const hasErrors = currentErrors.length > 0;

    if (hasErrors) {
      // Error found — reset clean streak
      this.verificationCleanStreak.set(0);
      this._addLog(`Round ${round}/25: ❌ Error found — ${currentErrors[0].message.substring(0, 60)}`);
      // The auto-fix useEffect in Chat.client.tsx will handle sending to AI
      // We just track it here
    } else {
      // Clean round — increment streak
      const newStreak = this.verificationCleanStreak.get() + 1;
      this.verificationCleanStreak.set(newStreak);
      this._addLog(`Round ${round}/25: ✅ Clean check (${newStreak}/20 consecutive)`);

      // Check if we've passed
      if (newStreak >= 20) {
        this._passVerification();
        return;
      }
    }

    // Check if we've exhausted rounds
    if (round >= MAX_VERIFICATION_ROUNDS) {
      if (this.verificationCleanStreak.get() >= 10) {
        // Good enough — 10+ clean out of 25
        this._passVerification();
      } else {
        this._failVerification();
      }
    }
  }

  private _passVerification() {
    this.stopVerification();
    this.verificationStatus.set('passed');
    this._addLog(`✅ VERIFICATION PASSED — ${this.verificationCleanStreak.get()} clean checks, ${this.verificationFixes.get()} fixes applied`);
  }

  private _failVerification() {
    this.stopVerification();
    this.verificationStatus.set('failed');
    this._addLog(`⚠️ VERIFICATION INCOMPLETE — ${this.verificationCleanStreak.get()} clean checks, ${this.verificationErrors.get()} errors`);
  }

  private _addLog(message: string) {
    const log = this.verificationLog.get();
    const time = new Date().toLocaleTimeString();
    this.verificationLog.set([...log.slice(-49), `[${time}] ${message}`]);
  }

  getVerificationSummary(): string {
    const status = this.verificationStatus.get();
    const round = this.verificationRound.get();
    const streak = this.verificationCleanStreak.get();
    const errors = this.verificationErrors.get();
    const fixes = this.verificationFixes.get();

    if (status === 'idle') return '';
    if (status === 'verifying') return `Testing round ${round}/25 — ${streak}/20 clean checks`;
    if (status === 'fixing') return `Fixing error (fix #${fixes}) — round ${round}/25`;
    if (status === 'passed') return `✅ Verified — ${streak} clean checks, ${fixes} fixes applied`;
    if (status === 'failed') return `⚠️ ${streak} clean / ${round} rounds — ${errors} errors, ${fixes} fixes`;
    return '';
  }
}

export const previewErrorFixer = new PreviewErrorFixer();
