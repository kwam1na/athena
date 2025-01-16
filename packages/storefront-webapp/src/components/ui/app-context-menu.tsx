import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface PopUpMenuItem {
  title: string;
  action: () => void;
  icon?: React.ReactNode;
}

interface PopUpMenuProps {
  children: React.ReactNode;
  menuItems: PopUpMenuItem[];
}

export function AppContextMenu({ children, menuItems }: PopUpMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex items-center justify-center rounded-md border border-dashed text-sm">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {menuItems.map((item, index) => (
          <ContextMenuItem onClick={item.action} key={index} inset>
            {item.title}
            <ContextMenuShortcut>{item.icon}</ContextMenuShortcut>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
