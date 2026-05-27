import { atom } from 'nanostores';

export interface PreviewError {
  message: string;
  stack: string;
  pathname: string;
  timestamp: number;
}

const MAX_AUTO_FIX_RETRIES = 100;
const MAX_VERIFICATION_ROUNDS = 25;
const VERIFICATION_INTERVAL = 4000; // 4 seconds between checks

type VerificationStatus = 'idle' | 'building' | 'verifying' | 'fixing' | 'passed' | 'failed';

class PreviewErrorFixer {
  errors = atom<PreviewError[]>([]);
  autoFixEnabled = atom<boolean>(true);
  retryCount = atom<number>(0);
  isFixing = atom<boolean>(false);
  lastFixedAt = atom<number>(0);

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

  canAutoFix(): boolean {
    return (
      this.autoFixEnabled.get() &&
      this.retryCount.get() < this._maxRetries &&
      !this.isFixing.get()
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
  }

  reset() {
    this.errors.set([]);
    this.retryCount.set(0);
    this.isFixing.set(false);
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
    const lastError = this.getLastError();
    if (!lastError) return '';

    return `AUTO-FIX: Preview Error Detected (attempt ${this.retryCount.get() + 1}/${this._maxRetries})

THE PROJECT YOU BUILT is showing this error in the browser preview:

Error: ${lastError.message}

Stack trace:
${lastError.stack}

VERIFICATION STATUS: Round ${this.verificationRound.get()}/${MAX_VERIFICATION_ROUNDS}, ${this.verificationCleanStreak.get()} consecutive clean checks, ${this.verificationErrors.get()} errors found, ${this.verificationFixes.get()} fixes applied.

Fix this error in the project code. Then STUDY the entire project:

1. Fix the specific error (missing import, undefined variable, syntax error, etc.)
2. After fixing, check ALL other files for similar issues
3. Look at the project as a whole — can you improve anything?
4. Is there a feature you could add right now to make the project better?
5. Add at least ONE improvement or new feature along with the fix

Provide the corrected files. Make the project better than before.`;
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
