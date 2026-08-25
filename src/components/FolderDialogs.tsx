import { useRef, useState } from "react";
import { Modal, ModalButton } from "./Modal";
import { FolderPlusIcon, TrashIcon } from "./Icon";

/** Styled replacement for the native `window.prompt` used to name a new folder
 *  (issue #15). Enter confirms, empty names are rejected, and it matches the app. */
export function FolderCreateModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
    onClose();
  };

  const close = () => {
    setName("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="New folder"
      description="Group related clips together. Give the folder a name."
      icon={<FolderPlusIcon className="h-4.5 w-4.5" />}
      initialFocusRef={inputRef}
      footer={
        <>
          <ModalButton onClick={close}>Cancel</ModalButton>
          <ModalButton variant="primary" onClick={submit} disabled={!trimmed}>
            Create folder
          </ModalButton>
        </>
      }
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Folder name"
        maxLength={80}
        className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
    </Modal>
  );
}

/** Styled confirmation for deleting a folder (issue #16). Offers the same choice the
 *  old `window.confirm` did — keep the clips or delete them too — but inline and clear. */
export function FolderDeleteModal({
  folder,
  onClose,
  onConfirm,
}: {
  /** The folder to delete, or null when the dialog is closed. */
  folder: { id: string; name: string; item_count: number } | null;
  onClose: () => void;
  onConfirm: (id: string, deleteItems: boolean) => void;
}) {
  const [deleteItems, setDeleteItems] = useState(false);

  const close = () => {
    setDeleteItems(false);
    onClose();
  };

  return (
    <Modal
      open={folder !== null}
      onClose={close}
      danger
      title="Delete folder"
      icon={<TrashIcon className="h-4.5 w-4.5" />}
      description={
        <>
          Delete <span className="font-medium text-fg">“{folder?.name}”</span>? This can’t be
          undone.
        </>
      }
      footer={
        <>
          <ModalButton onClick={close}>Cancel</ModalButton>
          <ModalButton
            variant="danger"
            onClick={() => {
              if (folder) onConfirm(folder.id, deleteItems);
              close();
            }}
          >
            Delete
          </ModalButton>
        </>
      }
    >
      {folder != null && folder.item_count > 0 && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-bg px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            checked={deleteItems}
            onChange={(e) => setDeleteItems(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
          />
          <span className="text-fg-muted">
            Also delete the {folder.item_count} clip{folder.item_count === 1 ? "" : "s"} inside.
            <span className="mt-0.5 block text-xs text-fg-faint">
              Leave unchecked to keep the clips in your history.
            </span>
          </span>
        </label>
      )}
    </Modal>
  );
}
