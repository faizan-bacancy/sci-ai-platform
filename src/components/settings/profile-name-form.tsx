"use client";

import { useTransition, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import { updateProfileNameAction } from "@/app/actions/profile";
import {
  updateProfileNameSchema,
  type UpdateProfileNameInput,
} from "@/lib/validation/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileNameForm({
  initialName,
  email,
  role,
}: {
  initialName: string;
  email: string;
  role: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<null | { type: "ok" | "error"; msg: string }>(null);

  const form = useForm<UpdateProfileNameInput>({
    resolver: zodResolver(updateProfileNameSchema),
    defaultValues: { name: initialName },
  });

  function onSubmit(values: UpdateProfileNameInput) {
    setStatus(null);
    startTransition(async () => {
      const result = await updateProfileNameAction(values);
      if (!result.ok) {
        setStatus({ type: "error", msg: result.message });
        form.setError("name", { message: result.message });
        return;
      }
      setStatus({ type: "ok", msg: "Saved." });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-1 text-sm text-muted-foreground">
          <div>Email: {email}</div>
          <div>Role: {role}</div>
        </div>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register("name")} />
            {form.formState.errors.name?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>

          {status ? (
            <p
              className={
                status.type === "ok"
                  ? "text-sm text-green-600"
                  : "text-sm text-destructive"
              }
            >
              {status.msg}
            </p>
          ) : null}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

