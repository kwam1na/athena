import { Modal } from "@/components/ui/modal";

interface OverlayModalProps {
  children?: React.ReactNode;
  isOpen: boolean;
  title: string;
  description: string;
  withoutHeader?: boolean;
  onClose: () => void;
}

export const OverlayModal: React.FC<OverlayModalProps> = ({
  children,
  isOpen,
  title,
  description,
  onClose,
  withoutHeader,
}) => {
  return (
    <Modal
      title={title}
      description={description}
      isOpen={isOpen}
      onClose={onClose}
      withoutCloseButton={true}
      withoutHeader={withoutHeader}
    >
      <div>{children}</div>
    </Modal>
  );
};
