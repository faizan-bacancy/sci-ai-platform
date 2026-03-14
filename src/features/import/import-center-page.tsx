"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useProfile } from "@/components/app/profile-context";
import { ImportWizard } from "@/components/import/import-wizard";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";
import { downloadWorkbook } from "@/lib/excel";
import { generateTemplateWorkbook } from "@/lib/import/import-templates";
import { importEntityOptions } from "@/lib/import/import-config";
import type { ImportEntity } from "@/lib/import/import-config";

type ImportRunRow = {
  id: string;
  user_id: string;
  entity_type: string;
  file_name: string | null;
  total_rows: number;
  inserted_rows: number;
  updated_rows: number;
  error_rows: number;
  status: string;
  created_at: string;
};

function allowedEntitiesForRole(role: string): ImportEntity[] {
  if (role === "planner") {
    return ["products", "inventory", "purchase_orders", "purchase_order_lines"];
  }
  return ["products", "suppliers", "inventory", "purchase_orders", "purchase_order_lines"];
}

export function ImportCenterPage() {
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const allowedEntities = useMemo(
    () => allowedEntitiesForRole(profile.role),
    [profile.role],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["import_runs"],
    queryFn: async () => {
      const supabase = createClient();
      const { data: rows, error } = await supabase
        .from("import_runs")
        .select(
          "id,user_id,entity_type,file_name,total_rows,inserted_rows,updated_rows,error_rows,status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (rows ?? []) as ImportRunRow[];
    },
  });

  const templates = useMemo(() => importEntityOptions, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import center"
        subtitle="Bulk upload Excel files and track import history."
        actions={
          <Link href="/import/docs" className="text-sm text-primary underline">
            Import docs
          </Link>
        }
      />

      {writable ? (
        <ImportWizard
          allowedEntities={allowedEntities}
          onCompleted={() => {
            void refetch();
          }}
        />
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            You do not have permission to import data.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {templates.map((template) => (
              <Button
                key={template.key}
                variant="secondary"
                onClick={() => {
                  const wb = generateTemplateWorkbook(template.key);
                  downloadWorkbook(wb, `${template.templateFileName}.xlsx`);
                }}
              >
                Download {template.label} template
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (data ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No imports yet.</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Who</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.user_id}</TableCell>
                      <TableCell>{row.entity_type}</TableCell>
                      <TableCell>{row.file_name ?? "-"}</TableCell>
                      <TableCell>
                        {row.inserted_rows + row.updated_rows}/{row.total_rows}
                      </TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
