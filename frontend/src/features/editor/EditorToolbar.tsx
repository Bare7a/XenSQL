import { Bookmark, Check, CircleAlert, Clock, GitBranch, Pencil, Play, PlayCircle, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatBinding, getEffectiveBinding } from '@/shared/lib/shortcuts';
import type { TxnState } from '@/types';

interface Props {
  isQueryRunning: boolean;
  onCancelQuery?: () => void;
  runQuery: (selectedOnly: boolean) => void;
  onSaveQuery?: () => void;
  onRenameSavedQuery?: () => void;
  savedQueryId?: string;
  txnState?: TxnState;
  onBeginTxn?: () => void;
  onCommitTxn?: () => void;
  onRollbackTxn?: () => void;
}

export function EditorToolbar({
  isQueryRunning,
  onCancelQuery,
  runQuery,
  onSaveQuery,
  onRenameSavedQuery,
  savedQueryId,
  txnState,
  onBeginTxn,
  onCommitTxn,
  onRollbackTxn,
}: Props) {
  const { t } = useTranslation();
  const inTxn = txnState === 'active' || txnState === 'error';

  return (
    <div className="toolbar">
      {isQueryRunning && onCancelQuery ? (
        <button
          type="button"
          className="btn btn-sm btn-stop"
          onClick={onCancelQuery}
          data-tooltip={t('tooltip.stopQuery')}
        >
          <Square className="icon-sm" fill="currentColor" /> {t('editor.stop')}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => runQuery(true)}
            data-tooltip={t('tooltip.runSelection', {
              shortcut: formatBinding(getEffectiveBinding('runSelection')),
            })}
          >
            <Play className="icon-sm" /> {t('editor.run')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => runQuery(false)}
            data-tooltip={t('tooltip.runAll', {
              shortcut: formatBinding(getEffectiveBinding('runAll')),
            })}
          >
            <PlayCircle className="icon-sm" /> {t('editor.runAll')}
          </button>
        </>
      )}
      {onSaveQuery && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onSaveQuery}
          data-tooltip={
            savedQueryId
              ? t('tooltip.updateSavedQuery', {
                  shortcut: formatBinding(getEffectiveBinding('saveQuery')),
                })
              : t('tooltip.saveQuery', {
                  shortcut: formatBinding(getEffectiveBinding('saveQuery')),
                })
          }
        >
          <Bookmark className="icon-sm" /> {savedQueryId ? t('editor.update') : t('editor.save')}
        </button>
      )}
      {savedQueryId && onRenameSavedQuery && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRenameSavedQuery}
          data-tooltip={t('tooltip.renameSavedQuery', {
            shortcut: formatBinding(getEffectiveBinding('renameSavedQuery')),
          })}
        >
          <Pencil className="icon-sm" /> {t('editor.rename')}
        </button>
      )}
      {onBeginTxn && !inTxn && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onBeginTxn}
          disabled={isQueryRunning}
          data-tooltip={t('tooltip.beginTxn')}
        >
          <GitBranch className="icon-sm" /> {t('editor.beginTxn')}
        </button>
      )}
      {inTxn && (
        <>
          <span
            className={`toolbar-txn-badge ${txnState === 'error' ? 'toolbar-txn-badge-error' : ''}`}
            data-tooltip={txnState === 'error' ? t('tooltip.txnError') : t('tooltip.txnActive')}
          >
            {txnState === 'error' ? (
              <CircleAlert className="icon-sm toolbar-txn-icon" />
            ) : (
              <Clock className="icon-sm toolbar-txn-icon" />
            )}
            {txnState === 'error' ? t('editor.txnError') : t('editor.txnActive')}
          </span>
          {onCommitTxn && (
            <button
              type="button"
              className="btn btn-sm btn-txn-commit"
              onClick={onCommitTxn}
              disabled={isQueryRunning}
              data-tooltip={t('tooltip.commitTxn')}
            >
              <Check className="icon-sm" /> {t('editor.commitTxn')}
            </button>
          )}
          {onRollbackTxn && (
            <button
              type="button"
              className="btn btn-sm btn-txn-rollback"
              onClick={onRollbackTxn}
              disabled={isQueryRunning}
              data-tooltip={t('tooltip.rollbackTxn')}
            >
              <X className="icon-sm" /> {t('editor.rollbackTxn')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
