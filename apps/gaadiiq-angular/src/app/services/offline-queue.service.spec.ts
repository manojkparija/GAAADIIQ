import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { OfflineQueueService } from './offline-queue.service';

describe('OfflineQueueService', () => {
  let service: OfflineQueueService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [OfflineQueueService],
    });
    service = TestBed.inject(OfflineQueueService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should enqueue a request and persist to localStorage', () => {
    service.enqueue('/api/test', 'POST', { foo: 'bar' });
    expect(service.pendingCount).toBe(1);
    const stored = JSON.parse(localStorage.getItem('gaadiiq_offline_queue') ?? '[]');
    expect(stored.length).toBe(1);
    expect(stored[0].url).toBe('/api/test');
  });

  it('should drain queue on successful retry', async () => {
    service.enqueue('/api/test', 'POST', { data: 1 });
    expect(service.pendingCount).toBe(1);

    const drainPromise = service.drainQueue();
    const req = httpMock.expectOne('/api/test');
    req.flush({ ok: true });
    await drainPromise;

    expect(service.pendingCount).toBe(0);
  });

  it('should re-queue on failure (up to MAX_ATTEMPTS)', async () => {
    service.enqueue('/api/failing', 'POST', {});
    const drainPromise = service.drainQueue();
    const req = httpMock.expectOne('/api/failing');
    req.error(new ErrorEvent('network'));
    await drainPromise;

    expect(service.pendingCount).toBe(1);
  });
});
