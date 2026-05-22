{{/*
Expand the name of the chart.
*/}}
{{- define "loyaltyos.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "loyaltyos.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "loyaltyos.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "loyaltyos.labels" -}}
helm.sh/chart: {{ include "loyaltyos.chart" . }}
{{ include "loyaltyos.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "loyaltyos.selectorLabels" -}}
app.kubernetes.io/name: {{ include "loyaltyos.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API selector labels
*/}}
{{- define "loyaltyos.api.selectorLabels" -}}
{{ include "loyaltyos.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
API labels
*/}}
{{- define "loyaltyos.api.labels" -}}
{{ include "loyaltyos.labels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Admin selector labels
*/}}
{{- define "loyaltyos.admin.selectorLabels" -}}
{{ include "loyaltyos.selectorLabels" . }}
app.kubernetes.io/component: admin
{{- end }}

{{/*
Admin labels
*/}}
{{- define "loyaltyos.admin.labels" -}}
{{ include "loyaltyos.labels" . }}
app.kubernetes.io/component: admin
{{- end }}

{{/*
Portal selector labels
*/}}
{{- define "loyaltyos.portal.selectorLabels" -}}
{{ include "loyaltyos.selectorLabels" . }}
app.kubernetes.io/component: portal
{{- end }}

{{/*
Portal labels
*/}}
{{- define "loyaltyos.portal.labels" -}}
{{ include "loyaltyos.labels" . }}
app.kubernetes.io/component: portal
{{- end }}

{{/*
BullMQ worker selector labels
*/}}
{{- define "loyaltyos.bullmqWorker.selectorLabels" -}}
{{ include "loyaltyos.selectorLabels" . }}
app.kubernetes.io/component: bullmq-worker
{{- end }}

{{/*
BullMQ worker labels
*/}}
{{- define "loyaltyos.bullmqWorker.labels" -}}
{{ include "loyaltyos.labels" . }}
app.kubernetes.io/component: bullmq-worker
{{- end }}

{{/*
Migrations job selector labels
*/}}
{{- define "loyaltyos.migrations.selectorLabels" -}}
{{ include "loyaltyos.selectorLabels" . }}
app.kubernetes.io/component: migrations
{{- end }}

{{/*
Migrations job labels
*/}}
{{- define "loyaltyos.migrations.labels" -}}
{{ include "loyaltyos.labels" . }}
app.kubernetes.io/component: migrations
{{- end }}

{{/*
Create the DATABASE_URL from either external config or the postgresql sub-chart
*/}}
{{- define "loyaltyos.databaseUrl" -}}
{{- if .Values.externalDatabase.enabled }}
{{- printf "postgresql://%s:%s@%s:%d/%s?sslmode=%s" .Values.externalDatabase.user .Values.externalDatabase.password .Values.externalDatabase.host (int .Values.externalDatabase.port) .Values.externalDatabase.database (ternary "require" "disable" .Values.externalDatabase.ssl) }}
{{- else if .Values.postgresql.enabled }}
{{- $pgUser := .Values.postgresql.auth.username }}
{{- $pgPass := .Values.postgresql.auth.password }}
{{- $pgDb := .Values.postgresql.auth.database }}
{{- printf "postgresql://%s:%s@%s-postgresql:%d/%s" $pgUser $pgPass .Release.Name 5432 $pgDb }}
{{- end }}
{{- end }}

{{/*
Create the REDIS_URL from either external config or the redis sub-chart
*/}}
{{- define "loyaltyos.redisUrl" -}}
{{- if .Values.externalRedis.enabled }}
{{- if .Values.externalRedis.password }}
{{- printf "redis://:%s@%s:%d" .Values.externalRedis.password .Values.externalRedis.host (int .Values.externalRedis.port) }}
{{- else }}
{{- printf "redis://%s:%d" .Values.externalRedis.host (int .Values.externalRedis.port) }}
{{- end }}
{{- else if .Values.redis.enabled }}
{{- $redisPass := .Values.redis.auth.password }}
{{- if $redisPass }}
{{- printf "redis://:%s@%s-redis-master:%d" $redisPass .Release.Name 6379 }}
{{- else }}
{{- printf "redis://%s-redis-master:%d" .Release.Name 6379 }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Image registry helper
*/}}
{{- define "loyaltyos.image" -}}
{{- $registry := .imageRoot.registry | default .Values.global.imageRegistry -}}
{{- $repository := .imageRoot.repository -}}
{{- $tag := .imageRoot.tag | default .Chart.AppVersion -}}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repository $tag }}
{{- else }}
{{- printf "%s:%s" $repository $tag }}
{{- end }}
{{- end }}
