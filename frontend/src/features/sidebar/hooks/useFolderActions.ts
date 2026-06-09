import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/shared/lib/api';
import { appConfirm, appError, appPrompt } from '@/shared/lib/appDialog';
import { useConnections, useStoreActions } from '@/store/selectors';

export function useFolderActions(refreshConnections: () => Promise<void>) {
  const { t } = useTranslation();
  const connections = useConnections();
  const { setFolders } = useStoreActions();

  const refreshFolders = useCallback(async () => {
    try {
      setFolders(await api.listFolders());
    } catch (err) {
      void appError(err, t('errors.generic'));
    }
  }, [setFolders, t]);

  const moveToFolder = useCallback(
    async (connId: string, folderId: string) => {
      const conn = connections.find((c) => c.id === connId);
      if (!conn || conn.folderId === folderId) return;
      try {
        await api.saveConnection({ ...conn, folderId });
        await refreshConnections();
      } catch (err) {
        void appError(err, t('errors.generic'));
      }
    },
    [connections, refreshConnections, t],
  );

  const createFolder = useCallback(async () => {
    const name = await appPrompt({
      title: t('dialog.newFolderTitle'),
      label: t('dialog.folderNameLabel'),
      placeholder: t('dialog.folderNamePlaceholder'),
      confirmLabel: t('common.create'),
    });
    if (!name?.trim()) return;
    try {
      await api.saveFolder({ id: '', name: name.trim() });
      await refreshFolders();
    } catch (err) {
      void appError(err, t('errors.generic'));
    }
  }, [refreshFolders, t]);

  const renameFolder = useCallback(
    async (id: string, current: string) => {
      const name = await appPrompt({
        title: t('dialog.renameFolderTitle'),
        label: t('dialog.folderNameLabel'),
        defaultValue: current,
        confirmLabel: t('common.save'),
      });
      if (!name?.trim() || name.trim() === current) return;
      try {
        await api.saveFolder({ id, name: name.trim() });
        await refreshFolders();
      } catch (err) {
        void appError(err, t('errors.generic'));
      }
    },
    [refreshFolders, t],
  );

  const deleteFolder = useCallback(
    async (id: string, name: string) => {
      const ok = await appConfirm({
        title: t('dialog.deleteFolderTitle'),
        description: t('dialog.deleteFolderDescription', { name }),
        detail: t('dialog.deleteFolderDetail'),
        confirmLabel: t('common.delete'),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteFolder(id);
        await Promise.all([refreshFolders(), refreshConnections()]);
      } catch (err) {
        void appError(err, t('errors.generic'));
      }
    },
    [refreshFolders, refreshConnections, t],
  );

  return { refreshFolders, moveToFolder, createFolder, renameFolder, deleteFolder };
}
