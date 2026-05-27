import { Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vscodeDarkInit, vscodeLightInit } from '@uiw/codemirror-theme-vscode';
import type { Theme } from '~/types/theme.js';
import type { EditorSettings } from './CodeMirrorEditor';

export const darkTheme = EditorView.theme({}, { dark: true });
export const themeSelection = new Compartment();

export function getTheme(theme: Theme, settings: EditorSettings = {}): Extension {
  return [
    getEditorLayout(settings),
    theme === 'dark'
      ? themeSelection.of([getDarkTheme(settings)])
      : themeSelection.of([getLightTheme(settings)]),
  ];
}

export function reconfigureTheme(theme: Theme) {
  return themeSelection.reconfigure(
    theme === 'dark' ? getDarkTheme() : getLightTheme(),
  );
}

/**
 * Layout-only styles — NO colors, NO backgrounds.
 * Colors come from the VS Code theme.
 */
function getEditorLayout(settings: EditorSettings) {
  return EditorView.theme({
    '&': {
      fontSize: settings.fontSize ?? '14px',
    },
    '&.cm-editor': {
      height: '100%',
    },
    '.cm-cursor': {
      borderLeftWidth: '2px',
    },
    '.cm-scroller': {
      lineHeight: '1.6',
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
      '&:focus-visible': {
        outline: 'none',
      },
    },
    '.cm-line': {
      padding: '0 0 0 4px',
    },
    '.cm-gutters': {
      borderRight: '1px solid transparent',
    },
    '.cm-gutter': {
      '&.cm-lineNumbers': {
        fontSize: settings.gutterFontSize ?? settings.fontSize ?? '12px',
        minWidth: '48px',
      },
      '& .cm-activeLineGutter': {
        background: 'transparent',
      },
      '&.cm-foldGutter .cm-gutterElement > .fold-icon': {
        cursor: 'pointer',
        transform: 'translateY(2px)',
      },
    },
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
    },
    '.cm-tooltip-autocomplete > ul > li': {
      minHeight: '20px',
    },
    '.cm-panel.cm-search label': {
      marginLeft: '2px',
      fontSize: '12px',
    },
    '.cm-panel.cm-search .cm-button': {
      fontSize: '12px',
      borderRadius: '3px',
    },
    '.cm-panel.cm-search .cm-textfield': {
      fontSize: '12px',
    },
    '.cm-panel.cm-search input[type=checkbox]': {
      position: 'relative',
      transform: 'translateY(2px)',
      marginRight: '4px',
    },
    '.cm-panels-bottom': {
      borderTop: '1px solid transparent',
    },
    '.cm-panel.cm-search': {
      padding: '8px',
    },
    '.cm-panel.cm-search [name=close]': {
      top: '6px',
      right: '6px',
      padding: '0 6px',
      fontSize: '1rem',
      borderRadius: '4px',
    },
    '.cm-tooltip': {
      borderRadius: '4px',
    },
    '.cm-tooltip.cm-readonly-tooltip': {
      padding: '4px',
      whiteSpace: 'nowrap',
    },
  });
}

function getLightTheme(settings?: EditorSettings) {
  return vscodeLightInit({
    settings: {
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: settings?.fontSize ?? '14px',
    },
  });
}

function getDarkTheme(settings?: EditorSettings) {
  return vscodeDarkInit({
    settings: {
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: settings?.fontSize ?? '14px',
    },
  });
}
