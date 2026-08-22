import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService } from '../services/language.service';

/**
 * `{{ 'Browse Cars' | t }}`
 *
 * KEYED BY THE ENGLISH SENTENCE, NOT BY A CODE
 *
 * The usual shape is `{{ 'home.hero.title' | t }}` with every language in a
 * table. That is the better scheme for an app translated from the start. This
 * one has 11,370 lines of templates already written in English, and converting
 * them to codes would mean every one of those strings goes through a rename
 * where a typo produces `home.hero.titel` on the page — visible only to
 * someone reading that page in that language.
 *
 * Keying by the English text means:
 *   - a missing translation renders the English, which is what the page said
 *     before the pipe was added, so adding it can never make a page worse;
 *   - the templates stay readable — you can see what a page says by reading it;
 *   - the translator's job is a list of English sentences, not a list of codes.
 *
 * The cost is that editing English copy silently drops its translation. That is
 * the right way round: an English fix reverting one string to English beats a
 * code rename showing a key to a Hindi reader.
 *
 * `pure: false` because the language is a signal read inside transform() rather
 * than an input. A pure pipe would evaluate once and never update — the same
 * trap CLAUDE.md records for computed() over a plain field, which has shipped
 * twice. Cheap here: these are string lookups over a Map.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly lang = inject(LanguageService);

  transform(value: string): string {
    return this.lang.translate(value);
  }
}
