import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth';
import { privacyNoticeGuard } from './core/privacy-notice';

export const routes: Routes = [
  { path: 'login', title: 'nav.signIn', canActivate: [guestGuard], loadComponent: () => import('./pages/auth/login').then((m) => m.Login) },
  { path: 'register', title: 'nav.register', canActivate: [guestGuard], loadComponent: () => import('./pages/auth/register').then((m) => m.Register) },
  { path: 'forgot-password', title: 'nav.forgotPassword', loadComponent: () => import('./pages/auth/forgot-password').then((m) => m.ForgotPassword) },
  { path: 'reset-password', title: 'nav.resetPassword', loadComponent: () => import('./pages/auth/reset-password').then((m) => m.ResetPassword) },
  { path: 'verify-email', title: 'nav.verifyEmail', loadComponent: () => import('./pages/auth/verify-email').then((m) => m.VerifyEmail) },
  { path: 'privacy-notice', title: 'nav.privacyNotice', canActivate: [authGuard], loadComponent: () => import('./pages/auth/privacy-notice').then((m) => m.PrivacyNotice) },
  {
    path: '',
    canActivate: [authGuard, privacyNoticeGuard],
    loadComponent: () => import('./layout/app-layout').then((m) => m.AppLayout),
    children: [
      { path: '', title: 'nav.overview', loadComponent: () => import('./pages/overview').then((m) => m.Overview) },
      { path: 'grades', title: 'nav.grades', loadComponent: () => import('./pages/grades').then((m) => m.Grades) },
      { path: 'exams', redirectTo: 'grades' },
      { path: 'calendar', title: 'nav.calendar', loadComponent: () => import('./pages/calendar/calendar').then((m) => m.Calendar) },
      { path: 'agenda', redirectTo: 'calendar' },
      { path: 'absences', title: 'nav.absences', loadComponent: () => import('./pages/absences').then((m) => m.Absences) },
      { path: 'documents', title: 'nav.documents', loadComponent: () => import('./pages/documents').then((m) => m.Documents) },
      { path: 'mail', title: 'nav.mail', data: { fullHeight: true }, loadComponent: () => import('./pages/mail').then((m) => m.Mail) },
      { path: 'chat', title: 'nav.chat', data: { fullHeight: true }, loadComponent: () => import('./pages/chat').then((m) => m.Chat) },
      { path: 'drive', title: 'nav.drive', loadComponent: () => import('./pages/drive').then((m) => m.Drive) },
      { path: 'notes', title: 'nav.notes', data: { fullHeight: true }, loadComponent: () => import('./pages/notes').then((m) => m.Notes) },
      { path: 'settings', title: 'nav.settings', loadComponent: () => import('./pages/settings').then((m) => m.Settings) },
      { path: 'ai/helply', title: 'nav.helply', data: { fullHeight: true }, loadComponent: () => import('./pages/helply').then((m) => m.Helply) },
      { path: 'ai/mcp', title: 'nav.mcp', loadComponent: () => import('./pages/mcp').then((m) => m.Mcp) },
    ],
  },
  { path: 'connect/authorize', title: 'nav.authorize', canActivate: [authGuard, privacyNoticeGuard], loadComponent: () => import('./pages/connect-authorize').then((m) => m.ConnectAuthorize) },
  { path: '**', redirectTo: '' },
];
