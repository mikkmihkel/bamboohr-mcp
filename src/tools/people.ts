import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTtlCache, META_TTL_MS } from "../metaCache";
import { enforceRecordLimit } from "../policy";
import { READ_ONLY, positiveInt, run, type ToolContext } from "./shared";

export function register(server: McpServer, ctx: ToolContext): void {
  const { api } = ctx;
  const cache = createTtlCache(META_TTL_MS);
  const typeNames = () =>
    cache.get("trainingTypes", async () => new Map((await api.getTrainingTypes()).map((t) => [t.id, t.name])));

  server.registerTool(
    "bamboohr_training_types",
    {
      title: "Training types",
      description:
        "List the company's training types (name, category, required, renewable, renewal frequency in months, due window for new hires) and training categories. Use the type id with bamboohr_training_records.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(ctx, { tool: "bamboohr_training_types", count: (r: { types: unknown[] }) => r.types.length }, async () => {
        const [types, categories] = await Promise.all([api.getTrainingTypes(), api.getTrainingCategories()]);
        return { types, categories };
      })
  );

  server.registerTool(
    "bamboohr_training_records",
    {
      title: "Training records",
      description:
        "List one employee's completed trainings with completion date, instructor, hours, credits, cost and notes. Optionally limit to one training type. To check who is missing a required training, call this per employee.",
      inputSchema: {
        employeeId: positiveInt.describe("Internal employee id."),
        trainingTypeId: positiveInt.optional().describe("Only records of this training type (see bamboohr_training_types)."),
      },
      annotations: READ_ONLY,
    },
    async ({ employeeId, trainingTypeId }) =>
      run(
        ctx,
        { tool: "bamboohr_training_records", filters: { trainingTypeId }, employeeIds: [employeeId] },
        async () => {
          const [records, names] = await Promise.all([api.getTrainingRecords(employeeId, trainingTypeId), typeNames()]);
          return {
            employeeId,
            records: records.map((r) => {
              const name = names.get(r.trainingTypeId);
              return name ? { ...r, trainingTypeName: name } : r;
            }),
          };
        }
      )
  );

  // Dependents and employee files are family and document data: they are not registered at all
  // unless the install opted in at enrolment, so the model never sees that these tools exist.
  if (!ctx.settings.enableSensitiveTools) return;

  server.registerTool(
    "bamboohr_employee_dependents",
    {
      title: "Employee dependents",
      description:
        "List the dependents (children, spouse) recorded for ONE employee. employeeId is required and at most the per-call record limit of rows is returned. National id numbers arrive masked from BambooHR. Requires Benefits Administration permission.",
      inputSchema: {
        employeeId: positiveInt.describe("Internal employee id. Required: this tool reads one employee at a time."),
      },
      annotations: READ_ONLY,
    },
    async ({ employeeId }) =>
      run(ctx, { tool: "bamboohr_employee_dependents", employeeIds: [employeeId] }, async () => {
        const dependents = await api.getDependents(employeeId);
        enforceRecordLimit(dependents.length, ctx.settings.maxRecords, "Ask for one employee at a time.");
        return { dependents };
      })
  );

  server.registerTool(
    "bamboohr_employee_files",
    {
      title: "Employee files",
      description:
        "List the document categories and files stored on one employee's record (contracts, certificates, signed policies) with name, size, upload date and uploader. Metadata only; files are not downloaded.",
      inputSchema: {
        employeeId: positiveInt.describe("Internal employee id."),
      },
      annotations: READ_ONLY,
    },
    async ({ employeeId }) =>
      run(ctx, { tool: "bamboohr_employee_files", employeeIds: [employeeId] }, async () => ({
        employeeId,
        categories: await api.getEmployeeFiles(employeeId),
      }))
  );
}
