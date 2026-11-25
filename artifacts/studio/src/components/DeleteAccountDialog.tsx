import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteAccount, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { describeWriteError } from "@/lib/describeWriteError";
import { resetUser } from "@/lib/analytics";
import { clearErrorUser } from "@/lib/errorTracking";
import { toast } from "@/hooks/use-toast";

export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const deleteAccount = useDeleteAccount();
  const [password, setPassword] = useState("");

  function handleOpenChange(next: boolean) {
    if (!next) { setPassword(""); deleteAccount.reset(); }
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    deleteAccount.mutate({ data: { password } }, {
      onSuccess: () => {
        // Same synchronous cache clear as AppShell's logout, for the same Gate race.
        queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), { user: null });
        resetUser();
        clearErrorUser();
        toast({ title: "Your account was deleted." });
        navigate("/login", { replace: true });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="dialog-delete-account">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>This permanently deletes, and cannot be undone:</DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>your account and your record of accepting the terms</li>
            <li>your scenarios and all their solves</li>
            <li>your WatBot conversations, ratings and reports</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Anonymous site feedback cannot be traced to you and is not affected. Copies held by analytics and
            error-reporting services, and hosting backups, are not removed here; the Privacy Notice says how to ask.
          </p>
          {deleteAccount.isError && (
            <Alert variant="destructive" data-testid="alert-delete-error">
              <AlertDescription>{describeWriteError(deleteAccount.error, "Could not delete your account. Try again.")}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-password">Current password</Label>
            <Input id="delete-password" type="password" autoComplete="current-password" maxLength={128} value={password}
              onChange={(e) => setPassword(e.target.value)} data-testid="input-delete-password" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-cancel-delete">Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!password || deleteAccount.isPending} data-testid="button-confirm-delete">
              {deleteAccount.isPending ? "Deleting…" : "Delete my account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
