"use client";

import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { useTransition } from "react";

import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/actions/auth";
import { useUIStore } from "@/stores/ui-store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";

function initials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

export function TopNav({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { setMobileSidebarOpen } = useUIStore();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4" aria-hidden />
        </Button>
        <div className="text-sm font-medium md:hidden">SupplyIQ</div>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open profile menu"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "gap-2 px-2.5",
              isPending && "pointer-events-none opacity-60",
            )}
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback>{initials(profile.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-[200px] truncate md:inline">
              {profile.name}
            </span>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {profile.name}
                  </p>
                  <p
                    className="max-w-[18rem] truncate text-xs leading-snug text-muted-foreground"
                    title={profile.email}
                  >
                    {profile.email}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    Role: {profile.role}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  startTransition(async () => {
                    await logoutAction();
                    router.replace("/login");
                  })
                }
              >
                {isPending ? "Logging out…" : "Logout"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}


