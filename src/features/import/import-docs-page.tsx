import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";

export function ImportDocsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Import documentation" subtitle="How to format files for SupplyIQ imports." />
      <Card>
        <CardHeader>
          <CardTitle>Quick steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal pl-4">
            <li>Download the correct template from the Import Center.</li>
            <li>Fill your data under the Template sheet headers.</li>
            <li>Save as .xlsx or .csv and upload.</li>
            <li>Map any columns that were not auto-matched.</li>
            <li>Review validation errors and import valid rows.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
