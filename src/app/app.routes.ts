import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { LoginComponent } from './login/login.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'plants', canActivate: [authGuard], loadComponent: () => import('./plant-catalog/plant-catalog-list.component').then(m => m.PlantCatalogListComponent) },
  { path: 'plants/:id', canActivate: [authGuard], loadComponent: () => import('./plant-catalog/plant-detail.component').then(m => m.PlantDetailComponent) },
  { path: 'garden', canActivate: [authGuard], loadComponent: () => import('./garden/garden-layout.component').then(m => m.GardenLayoutComponent) },
  // New beds are added in a dialog on the garden page; the old page's address opens it.
  { path: 'garden/new', redirectTo: () => inject(Router).createUrlTree(['/garden'], { queryParams: { newBed: 1 } }) },
  { path: 'tasks', canActivate: [authGuard], loadComponent: () => import('./tasks/task-agenda.component').then(m => m.TaskAgendaComponent) },
  { path: 'settings', canActivate: [authGuard], loadComponent: () => import('./settings/settings.component').then(m => m.SettingsComponent) },
  { path: '', canActivate: [authGuard], loadComponent: () => import('./tasks/dashboard.component').then(m => m.DashboardComponent) },
];
