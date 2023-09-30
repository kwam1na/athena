import Link from "next/link";
import * as React from "react";

export default function Sidebar() {
  return (
    <div className="h-auto w-80 mt-4 ml-4 bg-brand-bg rounded flex flex-col">
      <nav className="flex-1 p-4">
        <ul>
          <div className="m-2 hover:text-gray-600 rounded block">
            <Link href={"/"}>Inventory</Link>
          </div>
          {/* <div className="m-2 hover:text-gray-600 rounded block">
            <Link href={"/settings"}>Settings</Link>
          </div> */}
        </ul>
      </nav>
    </div>
  );
}
