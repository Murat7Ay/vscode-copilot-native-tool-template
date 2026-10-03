# Example: from template to a "service definition" tool

**Documentation only.** This shows how a company could turn the template into a tool that
creates service definitions for Java methods. Nothing here is implemented in the template.

## The interaction

```text
Developer (agent mode, cursor in CustomerService.java):
  "Create a service definition for this method."

Agent:
  → reads the method (built-in tools, or the template's #inspectSelection)
  → calls acme_prepare_service_definition({
        serviceName: "CustomerInquiry", methodName: "findCustomer",
        sourceFile: "src/main/java/com/acme/customer/CustomerService.java",
        requestType: "CustomerInquiryRequest", responseType: "CustomerInquiryResponse",
        transactionType: "read", timeoutSeconds: 30 })        // serviceCode, category … unknown

Extension:
  → schema validation (types, lengths, enums)
  → propose(): checks the class/method exist, normalizes names, looks up the next free
     serviceCode from the project's existing definitions (enrichment), checks the category list
  → opens the review form:
       ✨ Service name *       CustomerInquiry          AI suggested
       ⛔ Service code *        (empty)                  required
       ◯  Category             general                  default
       ✨ Transaction type *    read                     AI suggested
       ✨ Timeout (seconds)     30                       AI suggested
       …
Developer:
  → fills in the service code, changes the timeout to 60, clicks Submit

Extension:
  → re-validates the submitted values → Approved<ServiceDefinition>
  → execute(): writes resources/services/CustomerInquiry.service
               optionally calls the company's service registry API through a port
  → returns to the agent: "Created resources/services/CustomerInquiry.service.
     The user changed: serviceCode, timeoutSeconds."
```

## What the developer writes

| Template piece | Service-definition tool |
|---|---|
| `package.json` tool entry | `acme_prepare_service_definition`, `modelDescription` explaining each field and when to use the tool; schema with all fields optional (form tool) |
| `propose()` | name rules, method-exists check via a `JavaModelPort` (implemented with the Java language server's commands or a simple parser), next free service code, category list |
| `review` | `{ kind: 'form', form: { title: 'Review service definition', fields: [...] } }` |
| `execute()` | render the `.service` file via `WorkspacePort.writeTextFile`; if the company registry must be updated, call a `ServiceRegistryPort` whose implementation lives in `src/host` and gets credentials from VS Code's authentication/secret storage, never from tool input |
| tests | fake `JavaModelPort` and `ServiceRegistryPort`; prove that a cancelled form neither writes the file nor calls the registry |

If the same company later wants a simpler "regenerate the definition file" tool, that is a
Pattern A tool with `review: { kind: 'vscodeConfirmation' }` and a confirmation such as:

```text
Update service definition "CustomerInquiry"
Affected resources:
- update: resources/services/CustomerInquiry.service
| Source | src/main/java/com/acme/customer/CustomerService.java#findCustomer |
This operation changes the workspace.
```
