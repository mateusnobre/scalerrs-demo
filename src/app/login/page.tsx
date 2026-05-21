'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async (mode: 'signin' | 'signup') => {
    setLoading(true);
    const supabase = createClient();
    const fn =
      mode === 'signin'
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(mode === 'signin' ? 'Signed in' : 'Account created — check email');
      window.location.href = '/dashboard';
    }
    setLoading(false);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Use a demo account, or sign up. Each user is mapped to a single org via the
            <code className="mx-1 rounded bg-zinc-100 px-1 text-xs">org_members</code>
            table, and every query goes through RLS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <Input data-qa="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="andar@demo.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Password</label>
            <Input data-qa="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button data-qa="login-submit" onClick={() => handle('signin')} disabled={loading} className="flex-1">
              Sign in
            </Button>
            <Button variant="outline" onClick={() => handle('signup')} disabled={loading} className="flex-1">
              Sign up
            </Button>
          </div>
          <p className="pt-2 text-xs text-zinc-500">
            Demo seed: <code className="text-zinc-700">andar@demo.com</code> /
            <code className="ml-1 text-zinc-700">acme@demo.com</code> — passwords set via Supabase Studio.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
