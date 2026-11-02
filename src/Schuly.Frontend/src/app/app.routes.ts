import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', title: 'Sign in', canActivate: [guestGuard], loadComponent: () => import('./pages/auth/login').then((m) => m.Login) },
  { path: 'register', title: 'Create account', canActivate: [guestGuard], loadComponent: () => import('./pages/auth/register').then((m) => m.Register) },
  { path: 'forgot-password', title: 'Forgot password', loadComponent: () => import('./pages/auth/forgot-password').then((m) => m.ForgotPassword) },
  { path: 'reset-password', title: 'Reset password', loadComponent: () => import('./pages/auth/reset-password').then((m) => m.ResetPassword) },
  { path: 'verify-email', title: 'Verify email', loadComponent: () => import('./pages/auth/verify-email').then((m) => m.VerifyEmail) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/app-layout').then((m) => m.AppLayout),
    children: [
      { path: '', title: 'Overview', loadComponent: () => import('./pages/overview').then((m) => m.Overview) },
      { path: 'grades', title: 'Grades', loadComponent: () => import('./pages/grades').then((m) => m.Grades) },
      { path: 'exams', title: 'Exams', loadComponent: () => import('./pages/exams').then((m) => m.Exams) },
      { path: 'calendar', title: 'Calendar', loadComponent: () => import('./pages/calendar/calendar').then((m) => m.Calendar) },
      { path: 'agenda', redirectTo: 'calendar' },
      { path: 'absences', title: 'Absences', loadComponent: () => import('./pages/absences').then((m) => m.Absences) },
      { path: 'documents', title: 'Documents', loadComponent: () => import('./pages/documents').then((m) => m.Documents) },
      { path: 'mail', title: 'Mail', data: { fullHeight: true }, loadComponent: () => import('./pages/mail').then((m) => m.Mail) },
      { path: 'chat', title: 'Chat', data: { fullHeight: true }, loadComponent: () => import('./pages/chat').then((m) => m.Chat) },
      { path: 'drive', title: 'Drive', loadComponent: () => import('./pages/drive').then((m) => m.Drive) },
      { path: 'notes', title: 'Notes', data: { fullHeight: true }, loadComponent: () => import('./pages/notes').then((m) => m.Notes) },
      { path: 'settings', title: 'Settings', loadComponent: () => import('./pages/settings').then((m) => m.Settings) },
      { path: 'ai/helply', title: 'Helply', data: { fullHeight: true }, loadComponent: () => import('./pages/helply').then((m) => m.Helply) },
      { path: 'ai/mcp', title: 'MCP', loadComponent: () => import('./pages/mcp').then((m) => m.Mcp) },
    ],
  },
  { path: 'connect/authorize', title: 'Authorize app', canActivate: [authGuard], loadComponent: () => import('./pages/connect-authorize').then((m) => m.ConnectAuthorize) },
  { path: '**', redirectTo: '' },
];
