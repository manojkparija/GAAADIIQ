import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, catchError } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  getCars(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/cars`).pipe(catchError(() => of([])));
  }
  getCarById(id: string | number): Observable<any> {
    return this.http.get<any>(`${this.base}/cars/${id}`).pipe(catchError(() => of(null)));
  }
  searchCars(query: string): Observable<any[]> {
    const params = new HttpParams().set('q', query);
    return this.http.get<any[]>(`${this.base}/cars/search`, { params }).pipe(catchError(() => of([])));
  }
  getListings(filters: Record<string, any> = {}): Observable<any[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params = params.set(k, String(v)); });
    return this.http.get<any[]>(`${this.base}/listings`, { params }).pipe(catchError(() => of([])));
  }
  createListing(data: any): Observable<any> {
    return this.http.post<any>(`${this.base}/listings`, data).pipe(catchError(() => of(null)));
  }
  login(email: string, password: string): Observable<any> {
    return this.http.post<any>(`${this.base}/auth/login`, { email, password }).pipe(catchError(() => of(null)));
  }
  register(data: any): Observable<any> {
    return this.http.post<any>(`${this.base}/auth/register`, data).pipe(catchError(() => of(null)));
  }
  getAIValuation(carId: string | number): Observable<any> {
    return this.http.get<any>(`${this.base}/ai/valuation/${carId}`).pipe(catchError(() => of(null)));
  }
  submitLoanInquiry(data: any): Observable<any> {
    return this.http.post<any>(`${this.base}/loans/inquiry`, data).pipe(catchError(() => of(null)));
  }
  getNotifications(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/notifications`).pipe(catchError(() => of([])));
  }
}
