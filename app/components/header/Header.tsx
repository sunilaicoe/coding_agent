import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { useEffect, useRef, useState } from 'react';

// Shared state for sidebar visibility
export const sidebarToggleStore = (() => {
  let listeners: Array<() => void> = [];
  let _isOpen = false;

  return {
    get isOpen() {
      return _isOpen;
    },
    toggle() {
      _isOpen = !_isOpen;
      listeners.forEach((l) => l());
    },
    open() {
      _isOpen = true;
      listeners.forEach((l) => l());
    },
    close() {
      _isOpen = false;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },
  };
})();

export function Header() {
  const chat = useStore(chatStore);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = sidebarToggleStore.subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsub;
  }, []);

  const isSidebarOpen = sidebarToggleStore.isOpen;

  return (
    <header
      className={classNames('flex items-center px-4 border-b h-[var(--header-height)] bg-white dark:bg-[#0a0a0a]', {
        'border-transparent': !chat.started,
        'border-gray-200 dark:border-white/[0.08]': chat.started,
      })}
    >
      <div className="flex items-center gap-3">
        {/* Sidebar Toggle Button */}
        <button
          onClick={() => sidebarToggleStore.toggle()}
          className={classNames(
            'w-9 h-9 flex items-center justify-center rounded-lg transition-colors',
            isSidebarOpen
              ? 'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-700 dark:hover:text-gray-300',
          )}
          title={isSidebarOpen ? 'Close sidebar' : 'Open chat history'}
          aria-label={isSidebarOpen ? 'Close sidebar' : 'Open chat history'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isSidebarOpen ? (
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </>
            ) : (
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="3" y1="9" x2="9" y2="9" />
                <line x1="3" y1="15" x2="9" y2="15" />
              </>
            )}
          </svg>
        </button>

        {/* GENESIS Logo */}
        <a href="/" className="flex items-center gap-2">
          <div className="flex items-baseline text-2xl" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span className="text-gray-950 dark:text-white uppercase font-bold" style={{ letterSpacing: '-1.5px' }}>
              GENESIS
            </span>
            <span className="animate-pulse" style={{ color: '#FF3B30', fontWeight: 800 }}>
              .
            </span>
          </div>
        </a>
      </div>
      {chat.started && (
        <>
          <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="">
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
