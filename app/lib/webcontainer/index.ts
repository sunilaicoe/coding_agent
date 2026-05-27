import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(() => {
        return WebContainer.boot({
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });
      })
      .then(async (webcontainer) => {
        webcontainerContext.loaded = true;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        const response = await fetch('/inspector-script.js');
        const inspectorScript = await response.text();
        await webcontainer.setPreviewScript(inspectorScript);

        // Listen for preview errors
        webcontainer.on('preview-message', (message) => {
          console.log('WebContainer preview message:', message);

          // Handle both uncaught exceptions and unhandled promise rejections
          if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
            const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
            const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';
            const errorMsg = 'message' in message ? message.message : 'Unknown error';
            const errorStack = cleanStackTrace(message.stack || '');

            // Show alert in UI
            workbenchStore.actionAlert.set({
              type: 'preview',
              title,
              description: errorMsg,
              content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${errorStack}`,
              source: 'preview',
            });

            // Feed error into auto-fix system
            try {
              import('~/lib/stores/preview-error-fixer').then(({ previewErrorFixer }) => {
                previewErrorFixer.addError({
                  message: errorMsg,
                  stack: errorStack,
                  pathname: message.pathname || '/',
                  timestamp: Date.now(),
                });
              });
            } catch (e) {
              console.warn('Failed to feed preview error to auto-fixer:', e);
            }
          }
        });

        return webcontainer;
      });


  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
