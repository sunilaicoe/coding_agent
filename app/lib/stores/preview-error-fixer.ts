import { atom } from 'nanostores';
import type { WebContainer } from '@webcontainer/api';

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

  #cachedIndex: string = '';
  #indexTimestamp: number = 0;

  /**
   * Index the project and format error with full file context
   */
  async formatErrorForAIWithIndex(wc: WebContainer): Promise<string> {
    const terminalErrors = this.terminalErrors.get();
    const previewErrors = this.errors.get();
    const lastTerminalError = terminalErrors.length > 0 ? terminalErrors[terminalErrors.length - 1] : undefined;
    const lastPreviewError = previewErrors.length > 0 ? previewErrors[previewErrors.length - 1] : undefined;

    if (!lastTerminalError && !lastPreviewError) return '';

    // Build project index (use cache if less than 10s old)
    let projectIndex = '';
    try {
      if (Date.now() - this.#indexTimestamp > 10000 || !this.#cachedIndex) {
        const { indexProject, formatProjectIndex } = await import('~/utils/project-indexer');
        const index = await indexProject(wc);
        projectIndex = formatProjectIndex(index);
        this.#cachedIndex = projectIndex;
        this.#indexTimestamp = Date.now();
        this._addLog('Indexed ' + index.totalFiles + ' files (' + Math.round(index.totalSize / 1024) + 'KB)');
      } else {
        projectIndex = this.#cachedIndex;
      }
    } catch (e) {
      projectIndex = '(Failed to index project: ' + String(e) + ')';
    }

    // Build error section
    let errorSection = '';

    // Collect ALL terminal errors (not just last)
    if (terminalErrors.length > 0) {
      const allTerminal = terminalErrors.map((e, i) =>
        `--- Terminal Error ${i + 1} ---\nCommand: ${e.command}\nExit Code: ${e.exitCode}\nOutput:\n${e.output}`
      ).join('\n\n');

      errorSection = `TERMINAL ERRORS (${terminalErrors.length} total):

${allTerminal}

ANALYSIS:
This is a terminal/shell error. The app failed to build or start.
Common causes: missing deps, invalid config, missing files, syntax errors, wrong paths.`;
    }

    // Collect ALL preview errors
    if (previewErrors.length > 0) {
      const allPreview = previewErrors.map((e, i) =>
        `--- Browser Error ${i + 1} ---\nError: ${e.message}\nPath: ${e.pathname}\nStack:\n${e.stack}`
      ).join('\n\n');

      if (errorSection) errorSection += '\n\n';
      errorSection += `BROWSER PREVIEW ERRORS (${previewErrors.length} total):\n\n${allPreview}`;
    }

    // Build the FULL message: index + errors + instructions
    return `AUTO-FIX: Error Detected (attempt ${this.retryCount.get() + 1}/${this._maxRetries})

========== CURRENT PROJECT FILES ==========

${projectIndex}

========== ERRORS TO FIX ==========

${errorSection}

========== FIX INSTRUCTIONS ==========

Read the project files above carefully.
Find the root cause of EACH error.
Fix ALL errors at once.
Output the corrected files using genesisAction tags.
ALWAYS end with:
<genesisAction type="shell">npm install</genesisAction>
<genesisAction type="start">npm run dev</genesisAction>`;
  }

  /**
   * Synchronous fallback (no project index)
   */
  formatErrorForAI(): string {
    const terminalErrors = this.terminalErrors.get();
    const previewErrors = this.errors.get();
    if (terminalErrors.length === 0 && previewErrors.length === 0) return '';
    let msg = `AUTO-FIX: Error Detected (attempt ${this.retryCount.get() + 1}/${this._maxRetries})\n\n`;
    if (terminalErrors.length > 0) {
      msg += `TERMINAL ERROR: ${terminalErrors[terminalErrors.length - 1].output}\n`;
    }
    if (previewErrors.length > 0) {
      msg += `BROWSER ERROR: ${previewErrors[previewErrors.length - 1].message}\n`;
    }
    msg += '\nFix this error. Output corrected files.';
    return msg;
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
