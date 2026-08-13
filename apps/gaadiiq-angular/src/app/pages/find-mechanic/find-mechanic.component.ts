import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ServiceRequestComponent } from '../../components/service-request/service-request.component';
import { SeoService } from '../../services/seo.service';

/**
 * Roadside help, as a page of its own.
 *
 * The flow already existed inside the AI Diagnosis modal and behind a button on
 * the TCO page, which is the wrong shape for it: someone whose car has just
 * stopped is not going to find help by opening a total-cost-of-ownership
 * calculator. A page has a URL, so it can sit in the navbar, be bookmarked
 * before it is needed, and be sent to someone by message — which is how a
 * stranded person actually gets to it.
 *
 * The request panel is not mounted until the user asks for it. It requests a
 * location fix in its constructor, and prompting for GPS on arrival — before
 * anyone has said they need help — is an ambush, and trains people to deny the
 * permission the feature depends on.
 */
@Component({
  selector: 'app-find-mechanic',
  standalone: true,
  imports: [CommonModule, RouterLink, ServiceRequestComponent],
  templateUrl: './find-mechanic.component.html',
  styleUrls: ['./find-mechanic.component.scss'],
})
export class FindMechanicComponent {
  private readonly seo = inject(SeoService);

  readonly started = signal(false);

  constructor() {
    this.seo.setPage(
      'Find a Nearby Mechanic — GAADIIQ',
      'Broken down? Send a repair request to every available GAADIIQ partner mechanic within 1 km. The first to accept comes to you.',
    );
  }
}
