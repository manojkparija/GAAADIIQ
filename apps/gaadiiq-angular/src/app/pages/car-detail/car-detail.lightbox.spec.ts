/**
 * The gallery's full-screen viewer.
 *
 * A thumbnail strip tells a buyer which photograph exists; it does not let
 * them look at the paint, the upholstery or the scuff on a bumper. These
 * tests pin the behaviour that makes looking possible: the zoom stays within
 * useful bounds, panning is only offered once there is something to pan to,
 * stepping between photographs wraps, and the keyboard drives all of it.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { CarDetailComponent } from './car-detail.component';

describe('CarDetailComponent — full-screen photograph viewer', () => {
  let c: CarDetailComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CarDetailComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(CarDetailComponent).componentInstance;
    c.car = { images: ['a.jpg', 'b.jpg', 'c.jpg'] } as any;
  });

  afterEach(() => {
    // The viewer locks page scroll while open; a leaked lock would freeze the
    // page for every test that follows.
    document.body.style.overflow = '';
  });

  it('opens on the image that was clicked and locks the page behind it', () => {
    c.openLightbox(2);

    expect(c.lightboxOpen()).toBeTrue();
    expect(c.activeImg()).toBe(2);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('refuses to open when the car has no photographs', () => {
    c.car = { images: [] } as any;

    c.openLightbox(0);

    expect(c.lightboxOpen()).toBeFalse();
  });

  it('restores page scrolling when closed', () => {
    c.openLightbox(0);
    c.closeLightbox();

    expect(c.lightboxOpen()).toBeFalse();
    expect(document.body.style.overflow).toBe('');
  });

  it('will not zoom out past the natural size, nor in past the useful limit', () => {
    c.setZoom(0.1);
    expect(c.zoom()).toBe(c.minZoom);

    c.setZoom(99);
    expect(c.zoom()).toBe(c.maxZoom);
  });

  it('drops any pan when the image returns to natural size', () => {
    c.setZoom(3);
    c.panX.set(120);
    c.panY.set(-40);

    c.setZoom(1);

    expect(c.panX()).toBe(0);
    expect(c.panY()).toBe(0);
  });

  it('ignores a drag while the image still fits on screen', () => {
    c.movePan({ clientX: 50, clientY: 50 } as PointerEvent);
    expect(c.panX()).toBe(0);

    c.startPan({ clientX: 0, clientY: 0, pointerId: 1, target: {} } as any);
    c.movePan({ clientX: 50, clientY: 50 } as PointerEvent);

    expect(c.panX()).toBe(0);
  });

  it('pans by the distance dragged once zoomed in', () => {
    c.setZoom(2);
    c.startPan({ clientX: 100, clientY: 100, pointerId: 1, target: {} } as any);
    c.movePan({ clientX: 130, clientY: 80 } as PointerEvent);

    expect(c.panX()).toBe(30);
    expect(c.panY()).toBe(-20);
  });

  it('wraps around both ends of the gallery and resets the zoom on the way', () => {
    c.openLightbox(0);
    c.setZoom(3);

    c.step(-1);
    expect(c.activeImg()).toBe(2);
    expect(c.zoom()).toBe(1);

    c.step(1);
    expect(c.activeImg()).toBe(0);
  });

  it('stays put when there is only one photograph', () => {
    c.car = { images: ['only.jpg'] } as any;

    c.step(1);

    expect(c.activeImg()).toBe(0);
  });

  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    c.onKeydown(event);
    return event;
  }

  it('drives the viewer from the keyboard', () => {
    c.openLightbox(0);

    press('ArrowRight');
    expect(c.activeImg()).toBe(1);

    press('ArrowLeft');
    expect(c.activeImg()).toBe(0);

    press('+');
    expect(c.zoom()).toBeGreaterThan(1);

    press('0');
    expect(c.zoom()).toBe(1);

    press('Escape');
    expect(c.lightboxOpen()).toBeFalse();
  });

  it('leaves unrelated keys to the rest of the page', () => {
    c.openLightbox(0);

    const event = press('a');

    expect(event.defaultPrevented).toBeFalse();
  });

  it('ignores the keyboard entirely while closed', () => {
    press('ArrowRight');

    expect(c.activeImg()).toBe(0);
  });
});
