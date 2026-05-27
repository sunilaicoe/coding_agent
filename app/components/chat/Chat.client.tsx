import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { previewErrorFixer } from '~/lib/stores/preview-error-fixer';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    if (initialMessages.length === 0) return;

    console.log('[Reload] Chat restored with', initialMessages.length, 'messages');
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
    workbenchStore.showWorkbench.set(true);
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });
    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        chatMode,
        designScheme,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
        maxLLMSteps: mcpSettings.maxLLMSteps,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });
    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    // RELOAD RECOVERY: scan project, restart dev server, continue AI
    const reloadHandled = useRef(false);
    useEffect(() => {
      if (
        reloadHandled.current ||
        initialMessages.length === 0 ||
        isLoading ||
        !model ||
        !provider
      ) {
        return;
      }

      reloadHandled.current = true;

      // Scan project files from WebContainer
      const scanProject = async (wc: any): Promise<{files: string[], srcFiles: string[], hasPackageJson: boolean, deps: string[], scripts: string[]}> => {
        const result = { files: [] as string[], srcFiles: [] as string[], hasPackageJson: false, deps: [] as string[], scripts: [] as string[] };

        try {
          const entries = await wc.fs.readdir('/home/project', { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile()) result.files.push(entry.name);
          }
        } catch {}

        try {
          const srcEntries = await wc.fs.readdir('/home/project/src', { withFileTypes: true });
          for (const entry of srcEntries) {
            if (entry.isFile()) result.srcFiles.push(entry.name);
          }
        } catch {}

        try {
          const pkg = await wc.fs.readFile('/home/project/package.json', 'utf-8');
          result.hasPackageJson = true;
          const parsed = JSON.parse(pkg);
          result.deps = Object.keys(parsed.dependencies || {});
          result.scripts = Object.keys(parsed.scripts || {});
        } catch {}

        return result;
      };

      // Restart dev server
      const restartDevServer = async (): Promise<boolean> => {
        try {
          const { webcontainer } = await import('~/lib/webcontainer');
          const wc = await webcontainer;

          const previews = workbenchStore.previews.get();
          if (previews.length > 0 && previews.some((p) => p.ready)) {
            console.log('[Reload] Preview already running');
            return true;
          }

          if (!await wc.fs.readFile('/home/project/package.json', 'utf-8').catch(() => '')) return false;

          console.log('[Reload] Restarting dev server...');
          const terminal = workbenchStore.genesisTerminal();
          if (!terminal || !terminal.process) return false;

          await terminal.ready();
          await terminal.executeCommand('reload-install-' + Date.now(), 'npm install', () => {});
          await new Promise((r) => setTimeout(r, 2000));
          await terminal.executeCommand('reload-start-' + Date.now(), 'npm run dev', () => {});
          await new Promise((r) => setTimeout(r, 5000));

          const newPreviews = workbenchStore.previews.get();
          return newPreviews.length > 0;
        } catch (error) {
          console.error('[Reload] Restart failed:', error);
          return false;
        }
      };

      // MAIN RECOVERY LOGIC
      (async () => {
        console.log('[Reload] Starting recovery with', initialMessages.length, 'messages');

        // Collect ALL assistant content across all messages
        let allAssistantContent = '';
        let allFilepaths: string[] = [];
        for (const msg of initialMessages) {
          if (msg.role !== 'assistant') continue;
          const c = typeof msg.content === 'string' ? msg.content : '';
          allAssistantContent += c + '\n';

          // Extract file paths from genesisAction tags
          const fileMatches = c.matchAll(/type="file"\s+filePath="([^"]+)"/g);
          for (const m of fileMatches) allFilepaths.push(m[1]);
        }

        // Check if last response was cut off
        const lastAssistant = [...initialMessages].reverse().find((m) => m.role === 'assistant');
        const lastContent = lastAssistant
          ? (typeof lastAssistant.content === 'string' ? lastAssistant.content : '')
          : '';

        const hasUnclosedArtifact = lastContent.includes('<genesisArtifact') &&
          (lastContent.match(/<genesisArtifact/g) || []).length > (lastContent.match(/<\/genesisArtifact>/g) || []).length;
        const hasStartAction = allAssistantContent.includes('type="start"') || allAssistantContent.includes('npm run dev');
        const hasFileActions = allFilepaths.length > 0;
        const wasCutOff = hasUnclosedArtifact;

        // Wait for WebContainer to boot and files to replay
        const { webcontainer } = await import('~/lib/webcontainer');
        const wc = await webcontainer;
        await new Promise((r) => setTimeout(r, 8000));

        // Scan actual project state
        const project = await scanProject(wc);
        console.log('[Reload] Project scan:', JSON.stringify(project));

        // Try to restart dev server
        const serverOk = await restartDevServer();

        // Build status report
        const statusLines: string[] = [
          'PAGE RELOADED — PROJECT STATUS REPORT:',
          '',
          'FILES CREATED (' + allFilepaths.length + ' total):',
          ...allFilepaths.map((f) => '  - ' + f),
          '',
          'ACTUAL FILES IN WEBCONTAINER:',
          '  Root: ' + project.files.join(', '),
          '  Src: ' + project.srcFiles.join(', '),
          '',
          'PACKAGE.JSON: ' + (project.hasPackageJson ? 'EXISTS' : 'MISSING'),
          'DEPENDENCIES: ' + project.deps.join(', '),
          'SCRIPTS: ' + project.scripts.join(', '),
          '',
          'DEV SERVER: ' + (serverOk ? 'RUNNING' : 'NOT RUNNING'),
          'RESPONSE STATUS: ' + (wasCutOff ? 'CUT OFF (incomplete)' : 'COMPLETE'),
          '',
        ];

        // Decide what to do
        if (wasCutOff) {
          // AI was cut off — continue writing files
          statusLines.push(
            'ACTION: Your previous response was CUT OFF.',
            'Continue writing the remaining files from where you left off.',
            'Do NOT repeat any code already written.',
            'Do NOT recreate files that already exist.',
            'Write ONLY the files that were NOT yet written.',
            'ALWAYS end with:',
            '<genesisAction type="shell">npm install</genesisAction>',
            '<genesisAction type="start">npm run dev</genesisAction>',
          );
        } else if (!serverOk) {
          // Dev server not running — ask AI to fix and continue
          statusLines.push(
            'ACTION: The dev server is NOT running after reload.',
            'Possible causes: missing files, wrong package.json, broken imports.',
            '',
            'Please:',
            '1. Check if ALL required files exist (especially src/App.jsx)',
            '2. Fix any broken imports or syntax errors',
            '3. If the project is incomplete, add the remaining features',
            '4. Make sure package.json has correct dependencies and scripts',
            '5. End with npm install and npm run dev',
          );
        } else {
          // Everything running — check if project is complete or can be improved
          statusLines.push(
            'ACTION: The project is running. Review what exists and continue improving:',
            '1. Check if all features from the original request are implemented',
            '2. Add any missing features or components',
            '3. Improve UI/UX, animations, responsive design',
            '4. Fix any console errors or warnings',
            '5. Add polish: loading states, error boundaries, accessibility',
            '6. End with npm install and npm run dev',
          );
        }

        const reloadMsg = '[Model: ' + model + ']\n\n[Provider: ' + provider.name + ']\n\n' + statusLines.join('\n');
        console.log('[Reload] Sending recovery message to AI...');
        append({ role: 'user', content: reloadMsg });
      })();
    }, [initialMessages, isLoading, model, provider, append]);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const previewErrors = useStore(previewErrorFixer.errors);
    const terminalErrors = useStore(previewErrorFixer.terminalErrors);
    const previewRetryCount = useStore(previewErrorFixer.retryCount);

    // AUTO-FIX: Watch for ANY errors (preview + terminal) and automatically send them to the AI
    useEffect(() => {
      const hasErrors = previewErrors.length > 0 || terminalErrors.length > 0;

      if (
        !hasErrors ||
        !previewErrorFixer.canAutoFix() ||
        !chatStarted ||
        isLoading ||
        !model ||
        !provider
      ) {
        return;
      }

      // Delay to avoid race conditions with streaming
      const timer = setTimeout(() => {
        if (!previewErrorFixer.canAutoFix()) return;

        const errorMsg = previewErrorFixer.formatErrorForAI();

        if (!errorMsg) return;

        previewErrorFixer.incrementRetry();
        previewErrorFixer.setFixing(true);

        // Clear the alert since we're handling it
        workbenchStore.clearAlert();

        const fixMessage = `[Model: \${model}]\n\n[Provider: \${provider.name}]\n\n\${errorMsg}`;

        const errorType = terminalErrors.length > 0 ? 'TERMINAL' : 'PREVIEW';
        console.log(`AUTO-FIX: Sending \${errorType} error to AI (attempt \${previewErrorFixer.retryCount.get()})`);

        append({
          role: 'user',
          content: fixMessage,
        });

        // Mark as fixed after a delay to allow the AI to respond and files to be written
        const hadTerminalErrors = terminalErrors.length > 0;
        setTimeout(() => {
          previewErrorFixer.setFixing(false);
          previewErrorFixer.markFixed();

          // If this was a terminal error, restart the dev server after AI fixes files
          if (hadTerminalErrors) {
            console.log('[AUTO-FIX] Terminal error fixed \u2014 restarting dev server in 10s...');
            setTimeout(async () => {
              try {
                const { webcontainer } = await import('~/lib/webcontainer');
                const wc = await webcontainer;
                const terminal = workbenchStore.genesisTerminal();
                if (!terminal || !terminal.process) return;
                await terminal.ready();

                // Check if dev server is already running
                const previews = workbenchStore.previews.get();
                if (previews.length > 0 && previews.some((p) => p.ready)) {
                  console.log('[AUTO-FIX] Preview already running \u2014 no restart needed');
                  return;
                }

                console.log('[AUTO-FIX] Running npm install...');
                await terminal.executeCommand(`autofix-install-\${Date.now()}`, 'npm install', () => {});
                await new Promise((r) => setTimeout(r, 2000));
                console.log('[AUTO-FIX] Starting dev server...');
                await terminal.executeCommand(`autofix-start-\${Date.now()}`, 'npm run dev', () => {});
              } catch (e) {
                console.error('[AUTO-FIX] Restart failed:', e);
              }
            }, 10000);
          }
        }, 5000);
      }, 2000); // 2 second delay to let the error settle

      return () => clearTimeout(timer);
    }, [previewErrors, terminalErrors, previewRetryCount, chatStarted, isLoading, model, provider]);

    // VERIFICATION: Start 25-round testing when preview first appears
    const previews = useStore(workbenchStore.previews);
    const verificationStatus = useStore(previewErrorFixer.verificationStatus);

    useEffect(() => {
      if (
        previews.length > 0 &&
        previews[0].ready &&
        verificationStatus === 'idle' &&
        chatStarted
      ) {
        console.log('[Chat] Preview ready — starting 25-round verification');
        previewErrorFixer.startVerification();
      }
    }, [previews, verificationStatus, chatStarted]);

    // VERIFICATION: After a fix completes and preview is clean, continue verification
    const verificationRound = useStore(previewErrorFixer.verificationRound);
    const isFixing = useStore(previewErrorFixer.isFixing);

    useEffect(() => {
      if (
        verificationStatus === 'fixing' &&
        !isFixing &&
        previewErrors.length === 0 &&
        verificationRound > 0
      ) {
        // Fix was applied and no new errors — resume verification
        previewErrorFixer.verificationStatus.set('verifying');
      }
    }, [isFixing, previewErrors.length, verificationRound, verificationStatus]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });
        setData([]);
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      // Animate intro out (examples div was removed, only intro remains)
      try {
        await animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn });
      } catch {
        // Element may not exist if already hidden
      }

      chatStore.setKey('started', true);

      setChatStarted(true);

      // Reset preview error fixer for new chat
      previewErrorFixer.reset();
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__genesisSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      if (!chatStarted) {
        setFakeLoading(true);

        if (autoSelectTemplate) {
          let { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          // ALWAYS use React + Vite — never blank for any real project
          if (template === 'blank') {
            console.log('[Chat] Overriding blank → built-in React + Vite template');
            template = 'Vite React';
          }

          const temResp = await getTemplates(template, title).catch((e) => {
            console.error('[Chat] Template fetch failed, using built-in fallback:', e);
            return null;
          });

          if (temResp) {
            const { assistantMessage, userMessage } = temResp;
            const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

            setMessages([
              {
                id: `1-${new Date().getTime()}`,
                role: 'user',
                content: userMessageText,
                parts: createMessageParts(userMessageText, imageDataList),
              },
              {
                id: `2-${new Date().getTime()}`,
                role: 'assistant',
                content: assistantMessage,
              },
              {
                id: `3-${new Date().getTime()}`,
                role: 'user',
                content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                annotations: ['hidden'],
              },
            ]);

            const reloadOptions =
              uploadedFiles.length > 0
                ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
                : undefined;

            reload(reloadOptions);
            setInput('');
            Cookies.remove(PROMPT_COOKIE_KEY);

            setUploadedFiles([]);
            setImageDataList([]);

            resetEnhancer();

            textareaRef.current?.blur();
            setFakeLoading(false);

            return;
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={supabaseAlert}
        clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
        deployAlert={deployAlert}
        clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        llmErrorAlert={llmErrorAlert}
        clearLlmErrorAlert={clearApiErrorAlert}
        data={chatData}
        chatMode={chatMode}
        setChatMode={setChatMode}
        append={append}
        designScheme={designScheme}
        setDesignScheme={setDesignScheme}
        selectedElement={selectedElement}
        setSelectedElement={setSelectedElement}
        addToolResult={addToolResult}
        onWebSearchResult={handleWebSearchResult}
      />
    );
  },
);
