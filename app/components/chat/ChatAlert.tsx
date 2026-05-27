import { AnimatePresence, motion } from 'framer-motion';
import type { ActionAlert } from '~/types/actions';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { previewErrorFixer } from '~/lib/stores/preview-error-fixer';

interface Props {
  alert: ActionAlert;
  clearAlert: () => void;
  postMessage: (message: string) => void;
}

export default function ChatAlert({ alert, clearAlert, postMessage }: Props) {
  const { description, content, source } = alert;
  const retryCount = useStore(previewErrorFixer.retryCount);
  const isFixing = useStore(previewErrorFixer.isFixing);
  const verificationStatus = useStore(previewErrorFixer.verificationStatus);
  const verificationRound = useStore(previewErrorFixer.verificationRound);
  const verificationCleanStreak = useStore(previewErrorFixer.verificationCleanStreak);

  const isPreview = source === 'preview';
  const title = isPreview ? 'Preview Error' : 'Terminal Error';
  const message = isPreview
    ? 'We encountered an error while running the preview. Would you like GENESIS to analyze and help resolve this issue?'
    : 'We encountered an error while running terminal commands. Would you like GENESIS to analyze and help resolve this issue?';

  const isVerifying = verificationStatus === 'verifying';
  const isPassed = verificationStatus === 'passed';
  const isFailed = verificationStatus === 'failed';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className={`rounded-lg border bg-white dark:bg-[#111] p-4 mb-2 ${
          isPassed ? 'border-green-300 dark:border-green-800' : 'border-gray-200 dark:border-white/10'
        }`}
      >
        <div className="flex items-start">
          {/* Icon */}
          <motion.div
            className="flex-shrink-0"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            {isPassed ? (
              <div className="i-ph:check-circle-duotone text-xl text-green-500" />
            ) : (
              <div className="i-ph:warning-duotone text-xl text-genesis-elements-button-danger-text" />
            )}
          </motion.div>

          {/* Content */}
          <div className="ml-3 flex-1">
            <motion.h3
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-sm font-medium text-gray-900 dark:text-gray-100"
            >
              {isPassed ? '✅ Project Verified — All Tests Passed' : title}
            </motion.h3>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-2 text-sm text-gray-500 dark:text-gray-400"
            >
              {isPassed ? (
                <p>
                  The project has been tested {verificationRound} times with {verificationCleanStreak} consecutive
                  clean checks. {retryCount > 0 ? `${retryCount} errors were found and fixed automatically.` : 'No errors detected.'}
                </p>
              ) : (
                <>
                  <p>{message}</p>
                  {description && (
                    <div className="text-xs text-gray-500 p-2 bg-gray-50 dark:bg-white/5 rounded mt-3 mb-3 border border-gray-200 dark:border-white/10 font-mono">
                      {description}
                    </div>
                  )}
                </>
              )}
            </motion.div>

            {/* Verification Status Bar */}
            {(isVerifying || isFixing) && (
              <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                  <div className="i-ph:spinner-gap animate-spin text-sm" />
                  {isFixing ? 'Fixing Error...' : `Testing Round ${verificationRound}/25`}
                </div>
                <div className="mt-2 w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((verificationCleanStreak / 20) * 100, 100)}%` }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-blue-600 dark:text-blue-400">
                  {verificationCleanStreak}/20 consecutive clean checks needed
                  {retryCount > 0 && ` • ${retryCount} errors fixed`}
                </div>
              </div>
            )}

            {/* Failed status */}
            {isFailed && (
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ {verificationCleanStreak} clean checks out of {verificationRound} rounds.
                  {retryCount > 0 && ` ${retryCount} errors were fixed.`}
                  The project may still work — try it in the preview.
                </div>
              </div>
            )}

            {/* Actions */}
            <motion.div
              className="mt-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              {!isPassed && (
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      postMessage(
                        `*Fix this ${isPreview ? 'preview' : 'terminal'} error*\n\nError: ${description}\n\nStack:\n${content}`,
                      )
                    }
                    className={classNames(
                      'px-3 py-1.5 rounded-md text-sm font-medium',
                      'bg-gray-900 dark:bg-white text-white dark:text-gray-900',
                      'hover:bg-gray-800 dark:hover:bg-gray-100',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500',
                      'flex items-center gap-1.5 transition-colors',
                    )}
                  >
                    <div className="i-ph:chat-circle-duotone" />
                    Ask GENESIS
                  </button>
                  <button
                    onClick={clearAlert}
                    className={classNames(
                      'px-3 py-1.5 rounded-md text-sm font-medium',
                      'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300',
                      'hover:bg-gray-200 dark:hover:bg-white/20',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400',
                      'transition-colors',
                    )}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {isPassed && (
                <button
                  onClick={clearAlert}
                  className="px-3 py-1.5 rounded-md text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                >
                  Close
                </button>
              )}
            </motion.div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
