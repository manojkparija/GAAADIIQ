import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent {
  stats = [
    { value: '2,50,000+', label: 'Cars Listed' },
    { value: '18 Cities', label: 'Across India' },
    { value: '50,000+', label: 'Happy Buyers' },
    { value: '4.8 ★', label: 'App Rating' },
  ];

  team = [
    { name: 'Rahul Sharma', role: 'Co-Founder & CEO', avatar: 'RS', bio: 'Ex-Ola, IIT Delhi. 10 years in automotive & mobility.' },
    { name: 'Priya Nair',   role: 'Co-Founder & CTO', avatar: 'PN', bio: 'Ex-Google, IIT Bombay. Built AI systems at scale.' },
    { name: 'Arjun Mehta',  role: 'Head of Product',  avatar: 'AM', bio: 'Previously at Cars24. Obsessed with UX and data.' },
    { name: 'Sneha Joshi',  role: 'Head of Growth',   avatar: 'SJ', bio: 'Ex-Zomato. Grew GAADIIQ from 0 to 18 cities.' },
  ];

  values = [
    { icon: '🤖', title: 'AI-First',       desc: 'Every feature is powered by machine learning — from pricing to recommendations to fraud detection.' },
    { icon: '🔍', title: 'Transparency',   desc: 'No hidden charges, no fake reviews, no inflated prices. What you see is what you get.' },
    { icon: '🇮🇳', title: 'India-Built',   desc: 'Designed specifically for Indian roads, Indian budgets, and Indian buyers — not adapted from a global product.' },
    { icon: '🤝', title: 'Trust First',    desc: 'Every listing is verified. Every dealer is rated. Every transaction is protected.' },
  ];

  constructor(seo: SeoService) {
    seo.setPage('About Us', 'Learn about GAADIIQ — India\'s AI-first automotive intelligence platform making car buying smarter for everyone.');
  }
}
