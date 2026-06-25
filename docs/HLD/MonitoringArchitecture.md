# GAADIIQ.COM — Monitoring Architecture

**Version:** 1.0  
**Date:** 2026-06-24  
**Stack:** Prometheus · Grafana · Loki · Alertmanager

---

## 1. Observability Strategy

GAADIIQ uses the **Three Pillars of Observability**:

| Pillar | Tool | What it covers |
|---|---|---|
| **Metrics** | Prometheus + Grafana | System health, API latency, error rates, AI usage |
| **Logs** | Loki + Grafana | Application logs, access logs, error traces |
| **Traces** | OpenTelemetry + Grafana Tempo (Phase 2) | Request tracing across services |

All monitoring runs on the same Oracle Cloud VM (free) — separate Docker containers.

---

## 2. Monitoring Stack Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Oracle Cloud VM — Monitoring                │
│                                                         │
│  ┌──────────────┐     ┌──────────────┐                 │
│  │  Prometheus  │────►│   Grafana    │◄── Founder      │
│  │  :9090       │     │   :3001      │    Dashboard    │
│  └──────┬───────┘     └──────┬───────┘                 │
│         │ scrapes             │ queries                 │
│         │             ┌───────▼──────┐                 │
│         │             │     Loki     │                 │
│         │             │   :3100      │                 │
│         │             └──────▲───────┘                 │
│         │                    │ pushes logs              │
│  ┌──────▼───────┐     ┌──────┴───────┐                 │
│  │  FastAPI     │     │   Promtail   │                 │
│  │  /metrics    │     │  (log agent) │                 │
│  └──────────────┘     └─────────────┘                  │
│                                                         │
│  Scraped targets: FastAPI, Nginx, Redis, Node exporter  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Metrics — Prometheus

### 3.1 Scraped Targets

| Target | Port | Metrics |
|---|---|---|
| FastAPI (`/metrics`) | 8000 | Request count, latency histograms, error rate |
| Nginx (`stub_status`) | 8080 (internal) | Active connections, requests/s |
| Redis Exporter | 9121 | Memory usage, hit rate, connected clients |
| Node Exporter | 9100 | CPU, memory, disk, network I/O |
| OpenSearch | 9200 | Index size, query latency, JVM heap |

### 3.2 Key Metrics

```promql
# API Request Rate
rate(http_requests_total{job="gaadiiq-api"}[5m])

# API Error Rate (5xx)
rate(http_requests_total{job="gaadiiq-api", status=~"5.."}[5m])
  / rate(http_requests_total{job="gaadiiq-api"}[5m])

# P95 API Latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Redis Hit Rate
redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total)

# AI Advisor Requests
rate(gaadiiq_ai_advisor_requests_total[5m])

# Dealer Leads Created
increase(gaadiiq_leads_created_total[1h])

# Active Users (sessions)
gaadiiq_active_sessions_total
```

### 3.3 Custom Application Metrics (FastAPI)

```python
# Exposed via prometheus_client in FastAPI
gaadiiq_leads_created_total       # Counter
gaadiiq_ai_advisor_requests_total # Counter, labels: {model, result}
gaadiiq_car_views_total           # Counter, labels: {car_id, brand}
gaadiiq_search_queries_total      # Counter, labels: {has_results}
gaadiiq_comparison_sessions_total # Counter
gaadiiq_active_sessions_total     # Gauge
gaadiiq_recommendation_latency    # Histogram, labels: {engine_type}
```

---

## 4. Logs — Loki + Promtail

### 4.1 Log Sources

| Source | Log Format | Retention |
|---|---|---|
| FastAPI application | JSON structured | 90 days |
| Nginx access logs | Combined log format | 30 days |
| Nginx error logs | Text | 30 days |
| Docker container logs | JSON | 14 days |
| Ollama inference logs | Text | 7 days |

### 4.2 Log Levels

| Level | Used for |
|---|---|
| ERROR | Unhandled exceptions, DB connection failures |
| WARNING | Rate limit hits, JWT near-expiry, slow queries >500ms |
| INFO | Request completed, lead created, user registered |
| DEBUG | Disabled in production; enabled in staging |

### 4.3 Structured Log Format (FastAPI)

```json
{
  "timestamp": "2026-06-24T18:30:00.000Z",
  "level": "INFO",
  "service": "gaadiiq-api",
  "request_id": "uuid-here",
  "user_id": "uuid-or-null",
  "method": "POST",
  "path": "/api/v1/leads",
  "status_code": 201,
  "duration_ms": 45,
  "message": "Dealer lead created",
  "car_id": 42,
  "dealer_id": 7
}
```

### 4.4 Key Log Queries (LogQL)

```logql
# All errors in last 1 hour
{service="gaadiiq-api"} |= "ERROR" | since 1h

# Slow requests >500ms
{service="gaadiiq-api"} | json | duration_ms > 500

# Failed login attempts
{service="gaadiiq-api"} |= "auth" |= "401"

# AI Advisor errors
{service="gaadiiq-api"} |= "AIAdvisorService" |= "ERROR"
```

---

## 5. Alerting Rules

### 5.1 Critical Alerts (PagerDuty / Email — immediate)

| Alert | Condition | Action |
|---|---|---|
| API Down | `up{job="gaadiiq-api"} == 0` for 2min | Restart container; notify founder |
| High Error Rate | `error_rate > 5%` for 5min | Investigate logs; rollback if needed |
| DB Connection Failed | FastAPI DB health check fails | Check Supabase status; failover |
| Disk Full | `node_filesystem_avail < 5%` | Clean logs; expand disk |

### 5.2 Warning Alerts (Email — within 1 hour)

| Alert | Condition |
|---|---|
| High Latency | P95 API latency > 1s for 10min |
| Redis Memory High | Redis memory > 400MB |
| Low Cache Hit Rate | Redis hit rate < 50% |
| OpenSearch Heap High | JVM heap > 80% |
| AI Slow Response | Ollama inference > 10s average |

### 5.3 Info Alerts (Daily digest)

| Metric | Purpose |
|---|---|
| Daily leads count | Track revenue pipeline |
| Daily active users | Track growth |
| Top searched cars | Content prioritisation |
| Top comparison pairs | Feature insight |

---

## 6. Grafana Dashboards

### Dashboard 1: Platform Health
- API request rate and error rate (last 24h)
- P50/P95/P99 latency gauges
- Active sessions count
- VM CPU / Memory / Disk usage

### Dashboard 2: Business Metrics
- Leads created (today, this week, this month)
- Test drive bookings
- Top 10 cars by page views
- Top 10 search queries
- AI Advisor usage rate

### Dashboard 3: AI Performance
- Ollama inference latency histogram
- Recommendation engine latency
- Rule engine vs LLM request ratio
- ChromaDB query latency

### Dashboard 4: Database & Cache
- PostgreSQL: active connections, query time, slow query log
- Redis: hit rate, memory, evictions, connected clients
- OpenSearch: indexing rate, query latency, shard health

---

## 7. Health Check Endpoints

| Endpoint | Purpose | Response |
|---|---|---|
| `GET /api/health` | Basic liveness | `{"status": "ok"}` |
| `GET /api/health/ready` | Readiness (DB + Redis connected) | `{"db": true, "redis": true, "search": true}` |
| `GET /api/health/ai` | AI layer status | `{"ollama": true, "model": "llama3:8b", "latency_ms": 120}` |

Used by:
- Docker health checks (restart policy)
- GitHub Actions smoke test post-deploy
- Grafana synthetic monitoring probe

---

## 8. Runbook — Common Incidents

### API container crash
```bash
docker compose logs gaadiiq-api --tail 100
docker compose restart gaadiiq-api
```

### Redis memory exceeded
```bash
docker exec gaadiiq-redis redis-cli INFO memory
docker exec gaadiiq-redis redis-cli FLUSHDB  # only if safe
```

### OpenSearch red status
```bash
curl localhost:9200/_cluster/health?pretty
curl localhost:9200/_cat/shards?h=index,shard,state,reason
```

### Ollama model not loaded
```bash
docker exec gaadiiq-ollama ollama list
docker exec gaadiiq-ollama ollama pull llama3:8b
```

### Database connection pool exhausted
```bash
# Check Supabase dashboard for active connections
# Restart API to reset pool
docker compose restart gaadiiq-api
```

---

*Part of Phase 1 HLD. See: [HLD.md](HLD.md) | [SecurityArchitecture.md](SecurityArchitecture.md)*
