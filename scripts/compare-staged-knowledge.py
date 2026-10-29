#!/usr/bin/env python3
"""Non-writing, offline comparison of the reviewed staging package and local seed.

Usage: python scripts/compare-staged-knowledge.py PACKAGE_DIR SNAPSHOT_JSONL
No network, embeddings, database access or permission-gate changes.
"""
import collections
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value).hexdigest()


def normalize(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(text)).lower().replace('ё', 'е')).strip()


# Broad terms find related records, never establish subtype equivalence.
RELATED_TERMS = {
    'avian_influenza': ['птичий грипп', 'грипп птиц'],
    'newcastle_disease': ['ньюкасл', 'псевдочум'],
    'marek_disease': ['марека'],
    'coccidiosis': ['кокцидиоз', 'эймериоз'],
    'infectious_bronchitis': ['инфекционный бронхит', 'инфекционного бронхита', 'ИБК'],
    'infectious_bursal_disease': ['гамборо', 'гумборо', 'инфекционный бурсит'],
    'fowl_pox': ['оспа', 'оспы', 'оспой'],
    'infectious_laryngotracheitis': ['ларинготрахеит', 'ИЛТ'],
    'fowl_cholera': ['пастерелл'],
    'mycoplasma_gallisepticum': ['микоплазм'],
    'salmonella_enteritidis': ['сальмонелл', 'enteritidis'],
    'poultry_ectoparasites': ['эктопаразит', 'пухоед', 'пероед', 'клещ', 'кнемидокопт'],
    'intestinal_helminthiasis': ['гельминт', 'глист', 'аскарид'],
    'avian_botulism': ['ботулизм'],
}


def contains(text, term):
    term = normalize(term)
    if not term:
        return False
    if len(term) <= 4:
        return bool(re.search(r'(?<!\w)' + re.escape(term) + r'(?!\w)', text))
    return term in text


def verify_package(package):
    manifest = json.loads((package / 'manifest.json').read_text())
    assert manifest['production_import_allowed'] is False
    assert manifest['existing_database_reviewed'] is False
    for item in manifest['files']:
        path = (package / item['path']).resolve()
        assert path.is_relative_to(package.resolve()), 'Manifest path escapes package'
        data = path.read_bytes()
        assert len(data) == item['size_bytes'] and digest(data) == item['sha256'], item['path']
    cards = [json.loads(line) for line in (package / 'disease_candidates.ru.jsonl').read_text().splitlines() if line.strip()]
    sources = json.loads((package / 'sources.json').read_text())['sources']
    by_id = {source['source_id']: source for source in sources}
    assert len(cards) == manifest['candidate_count'] == 14
    assert len(by_id) == len(sources) == manifest['source_count'] == 15
    assert len({card['candidate_id'] for card in cards}) == len(cards)
    assert len({card['content_sha256'] for card in cards}) == len(cards)
    assert len({source['canonical_url'] for source in sources}) == len(sources)
    for card in cards:
        assert card['review']['production_import_allowed'] is False
        assert card['review']['state'] == 'candidate_staging'
        assert card['review']['existing_database_comparison'] == 'not_performed'
        assert card['review']['veterinary_review'] == 'pending'
        assert digest(canonical(card['content_ru']).encode()) == card['content_sha256']
        assert card['chunk_id'] == card['candidate_id'] + '.' + card['content_sha256'][:12]
        refs = card['source_ids'] + card['differential_source_ids']
        for refs_for_field in card['evidence_map'].values():
            refs += [source for source in refs_for_field if source != 'safety_policy.json']
        for concept in card.get('differential_external_concepts', []):
            refs += concept['source_ids']
        assert all(source in by_id for source in refs)
        assert card['dedup']['source_identity_sha256'] == [by_id[source]['source_identity_sha256'] for source in card['source_ids']]
    for source in sources:
        assert source['raw_source_sha256'] is None and source['raw_source_content_stored'] is False
        assert source['rights']['full_text_ingestion_allowed_in_this_package'] is False
    return cards, sources


def compare(cards, sources, rows, snapshot_hash):
    decisions = []
    for card in cards:
        names = [card['canonical_name_ru'], card['canonical_name_en']]
        for synonyms in card['synonyms'].values():
            names.extend(synonyms)
        terms = list(dict.fromkeys(names + RELATED_TERMS.get(card['concept_key'], [])))
        flat_content = ' '.join(' '.join(value) if isinstance(value, list) else str(value) for value in card['content_ru'].values())
        exact = []
        related = []
        for row in rows:
            row_text = row.get('content', row.get('text', ''))
            identity = row.get('chunk_id', row.get('id'))
            if normalize(row_text) == normalize(flat_content):
                exact.append(identity)
            haystack = normalize(str(row.get('topic', '')) + ' ' + row_text)
            found = [term for term in terms if contains(haystack, term)]
            if found:
                related.append({'existing_id': identity, 'source': row.get('source'), 'topic': row.get('topic'), 'matched_terms': found})
        decision = 'skip_exact_duplicate' if exact else 'needs_review_existing_concept' if related else 'needs_review_possible_gap'
        decisions.append({
            'candidate_id': card['candidate_id'], 'concept_key': card['concept_key'],
            'canonical_name_ru': card['canonical_name_ru'], 'decision': decision,
            'exact_existing_ids': exact, 'related_existing_records': related,
            'source_ids': card['source_ids'], 'content_sha256': card['content_sha256'],
            'source_comparison': 'unavailable: local snapshot lacks source URL/version/hash metadata',
            'coverage_warning': card['dedup'].get('overlap_warning', 'Keyword match is not confirmed equivalent coverage or a clinical conflict.'),
            'production_import_allowed': False,
        })
    counts = dict(collections.Counter(item['decision'] for item in decisions))
    return {
        'scope': 'offline staging comparison against local repository seed only',
        'snapshot_sha256': snapshot_hash, 'local_record_count': len(rows),
        'candidate_count': len(cards), 'source_count': len(sources),
        'decision_counts': counts, 'automatic_adds': 0, 'automatic_updates': 0,
        'production_import_allowed': False, 'live_database_mutation': 'none',
        'verified_package_manifest_files': 8, 'candidate_content_hashes_verified': True,
        'source_identity_references_verified': True,
        'limitations': ['No live database inventory', 'No semantic embeddings or clinical equivalence check',
                       'Possible gaps are not confirmed gaps; generic Salmonella/MG/parasite/influenza mentions do not establish subtype equivalence',
                       'Veterinary, rights and local-jurisdiction review remain pending',
                       'Source identity hashes are bibliographic references, not downloaded source-content hashes'],
        'source_rights_states': dict(collections.Counter(source['rights']['status'] for source in sources)),
        'decisions': decisions,
    }


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python scripts/compare-staged-knowledge.py PACKAGE_DIR SNAPSHOT_JSONL')
    directory, snapshot = Path(sys.argv[1]), Path(sys.argv[2])
    candidates, bibliography = verify_package(directory)
    data = snapshot.read_bytes()
    inventory = [json.loads(line) for line in data.decode().splitlines() if line.strip()]
    print(json.dumps(compare(candidates, bibliography, inventory, digest(data)), ensure_ascii=False, indent=2))
