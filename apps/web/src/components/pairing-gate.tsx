import { CheckSquareIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { usePair } from "@/lib/api";

/** Shown when the browser has no session cookie yet, e.g. a phone reaching the server over Tailscale. */
export function PairingGate() {
  const [token, setToken] = useState("");
  const pair = usePair();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() !== "") pair.mutate(token.trim());
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CheckSquareIcon />
          </div>
          <CardTitle>Connect to tasksmd</CardTitle>
          <CardDescription>
            Open the pairing link printed by tasksmd, or paste the token from it here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={pair.isError || undefined}>
                <FieldLabel htmlFor="pair-token">Token</FieldLabel>
                <Input
                  id="pair-token"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  value={token}
                  aria-invalid={pair.isError || undefined}
                  onChange={(event) => setToken(event.target.value)}
                />
                {pair.isError && <FieldError>{pair.error.message}</FieldError>}
              </Field>
              <Button type="submit" disabled={pair.isPending || token.trim() === ""}>
                {pair.isPending && <Spinner data-icon="inline-start" />}
                Pair this browser
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
