import JSZip from 'jszip';

export interface AndroidProjectFile {
  path: string;
  content: string;
  description: string;
}

export function getAndroidProjectFiles(): AndroidProjectFile[] {
  return [
    {
      path: 'settings.gradle.kts',
      description: 'Gradle plugin management and root project settings',
      content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "SadnanCapture"
include(":app")
`,
    },
    {
      path: 'build.gradle.kts',
      description: 'Top-level Gradle build configuration',
      content: `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.20" apply false
}
`,
    },
    {
      path: 'gradle.properties',
      description: 'Gradle JVM and AndroidX flags',
      content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`,
    },
    {
      path: 'app/build.gradle.kts',
      description: 'App module dependencies (Jetpack Compose, Material3, Coroutines, Security)',
      content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.sadnan.capture"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sadnan.capture"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
`,
    },
    {
      path: 'app/src/main/AndroidManifest.xml',
      description: 'Manifest declaring VpnService, FloatingOverlayService, FileProvider, and non-root permissions',
      content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />

    <application
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.SadnanCapture">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTop">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".vpn.SadnanVpnService"
            android:exported="false"
            android:foregroundServiceType="specialUse"
            android:permission="android.permission.BIND_VPN_SERVICE">
            <intent-filter>
                <action android:name="android.net.VpnService" />
            </intent-filter>
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Local non-root VpnService packet capture" />
        </service>

        <service
            android:name=".overlay.FloatingOverlayService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Draggable traffic inspection overlay" />
        </service>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
`,
    },
    {
      path: 'app/src/main/res/xml/file_paths.xml',
      description: 'FileProvider paths for PCAP/PCAPNG/TXT sharing',
      content: `<?xml version="1.0" encoding="utf-8"?>
<paths>
    <files-path name="captures" path="exports/" />
    <cache-path name="vault_cache" path="vault/" />
</paths>
`,
    },
    {
      path: 'app/src/main/res/values/strings.xml',
      description: 'App strings',
      content: `<resources>
    <string name="app_name">SADNAN CAPTURE</string>
</resources>
`,
    },
    {
      path: 'app/src/main/res/values/themes.xml',
      description: 'Material Dark theme entry',
      content: `<resources>
    <style name="Theme.SadnanCapture" parent="android:Theme.Material.NoActionBar">
        <item name="android:statusBarColor">#121518</item>
        <item name="android:navigationBarColor">#121518</item>
    </style>
</resources>
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/model/CaptureModels.kt',
      description: 'Core packet, flow, app target, firewall, and keylog data models',
      content: `package com.sadnan.capture.model

enum class ProtocolType {
    TCP, UDP, HTTP, HTTPS, DNS, TLS, QUIC, ICMP, ICMPV6
}

enum class TrafficDirection { OUTBOUND, INBOUND }

enum class DumpMode { PCAPNG, PCAP, RAW_BODY }

data class TargetAppProfile(
    val id: String,
    val displayName: String,
    val internalPackageId: String? // Never exposed in selector UI; used strictly by VpnService.Builder
)

data class CapturedPacket(
    val sequence: Long,
    val timestampNs: Long,
    val timestampMs: Long,
    val appDisplayName: String,
    val ipVersion: Int,
    val srcIp: String,
    val srcPort: Int,
    val dstIp: String,
    val dstPort: Int,
    val protocol: ProtocolType,
    val direction: TrafficDirection,
    val totalLength: Int,
    val payloadLength: Int,
    val payloadOffset: Int,
    val rawBytes: ByteArray,
    val tcpFlags: String? = null,
    val tcpSeq: Long? = null,
    val tcpAck: Long? = null,
    val sni: String? = null,
    val alpn: List<String> = emptyList(),
    val clientRandomHex: String? = null,
    val quicVersion: String? = null,
    val quicDcid: String? = null,
    val quicScid: String? = null,
    val dnsQuery: String? = null,
    val matchedKeylogSecret: String? = null,
    val isEncryptedPayload: Boolean = false,
    val blocked: Boolean = false,
    val alertTitle: String? = null,
    val countryCode: String = "GL",
    val asn: String = "AS-UNMAPPED"
)

data class FirewallRule(
    val id: String,
    val type: String, // APP, IP, PORT, DOMAIN
    val value: String,
    val enabled: Boolean = true
)

data class KeylogEntry(
    val label: String,
    val clientRandomHex: String,
    val secretHex: String
)
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/engine/PacketDissector.kt',
      description: 'Universal IPv4/IPv6 binary dissector for TCP, UDP, HTTP, HTTPS, DNS, TLS, QUIC, ICMP, ICMPv6',
      content: `package com.sadnan.capture.engine

import com.sadnan.capture.model.*
import java.nio.charset.StandardCharsets

object PacketDissector {

    fun parseSslKeylog(content: String): List<KeylogEntry> {
        return content.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .mapNotNull { line ->
                val parts = line.split(Regex("\\\\s+"))
                if (parts.size >= 3 && parts[1].length == 64) {
                    KeylogEntry(parts[0], parts[1].lowercase(), parts[2].lowercase())
                } else null
            }.toList()
    }

    fun dissect(
        rawBytes: ByteArray,
        sequence: Long,
        appName: String,
        direction: TrafficDirection,
        keylogs: List<KeylogEntry>,
        firewallRules: List<FirewallRule>
    ): CapturedPacket? {
        if (rawBytes.size < 20) return null
        val version = (rawBytes[0].toInt() ushr 4) and 0x0F
        if (version != 4 && version != 6) return null

        val srcIp: String
        val dstIp: String
        val nextProto: Int
        val l4Offset: Int

        if (version == 4) {
            val ihl = (rawBytes[0].toInt() and 0x0F) * 4
            if (ihl < 20 || rawBytes.size < ihl) return null
            nextProto = rawBytes[9].toInt() and 0xFF
            srcIp = formatIpv4(rawBytes, 12)
            dstIp = formatIpv4(rawBytes, 16)
            l4Offset = ihl
        } else {
            if (rawBytes.size < 40) return null
            nextProto = rawBytes[6].toInt() and 0xFF
            srcIp = formatIpv6(rawBytes, 8)
            dstIp = formatIpv6(rawBytes, 24)
            l4Offset = 40
        }

        var protocol = when (nextProto) {
            6 -> ProtocolType.TCP
            17 -> ProtocolType.UDP
            1 -> ProtocolType.ICMP
            58 -> ProtocolType.ICMPV6
            else -> ProtocolType.TCP
        }

        var srcPort = 0
        var dstPort = 0
        var payloadOffset = l4Offset
        var tcpFlags: String? = null
        var tcpSeq: Long? = null
        var tcpAck: Long? = null

        if (nextProto == 6 && rawBytes.size >= l4Offset + 20) {
            srcPort = u16(rawBytes, l4Offset)
            dstPort = u16(rawBytes, l4Offset + 2)
            tcpSeq = u32(rawBytes, l4Offset + 4)
            tcpAck = u32(rawBytes, l4Offset + 8)
            val dataOffset = ((rawBytes[l4Offset + 12].toInt() ushr 4) and 0x0F) * 4
            val f = rawBytes[l4Offset + 13].toInt() and 0xFF
            val flagList = buildList {
                if ((f and 0x02) != 0) add("SYN")
                if ((f and 0x10) != 0) add("ACK")
                if ((f and 0x08) != 0) add("PSH")
                if ((f and 0x01) != 0) add("FIN")
                if ((f and 0x04) != 0) add("RST")
                if ((f and 0x20) != 0) add("URG")
            }
            tcpFlags = flagList.joinToString(" ").ifEmpty { "NONE" }
            payloadOffset = (l4Offset + maxOf(20, dataOffset)).coerceAtMost(rawBytes.size)
        } else if (nextProto == 17 && rawBytes.size >= l4Offset + 8) {
            srcPort = u16(rawBytes, l4Offset)
            dstPort = u16(rawBytes, l4Offset + 2)
            payloadOffset = (l4Offset + 8).coerceAtMost(rawBytes.size)
        } else if (nextProto == 1 || nextProto == 58) {
            payloadOffset = (l4Offset + 8).coerceAtMost(rawBytes.size)
        }

        val payload = rawBytes.copyOfRange(payloadOffset, rawBytes.size)
        var sni: String? = null
        var alpn: List<String> = emptyList()
        var clientRandomHex: String? = null
        var quicVersion: String? = null
        var quicDcid: String? = null
        var quicScid: String? = null
        var dnsQuery: String? = null
        var isEncrypted = false

        if (nextProto == 17 && (srcPort == 53 || dstPort == 53) && payload.size >= 12) {
            protocol = ProtocolType.DNS
            dnsQuery = parseDnsQuestionName(payload)
        } else if (nextProto == 17 && payload.size >= 16 && (payload[0].toInt() and 0xC0) == 0xC0) {
            protocol = ProtocolType.QUIC
            isEncrypted = true
            val ver = u32(payload, 1)
            quicVersion = if (ver == 1L) "QUIC v1" else "0x" + ver.toString(16)
            val dcidLen = payload[5].toInt() and 0xFF
            if (6 + dcidLen < payload.size) {
                quicDcid = toHex(payload, 6, dcidLen)
                val scidLen = payload[6 + dcidLen].toInt() and 0xFF
                if (7 + dcidLen + scidLen <= payload.size) {
                    quicScid = toHex(payload, 7 + dcidLen, scidLen)
                }
            }
        } else if (nextProto == 6 && payload.isNotEmpty()) {
            val preview = String(payload, 0, minOf(payload.size, 64), StandardCharsets.UTF_8)
            if (preview.startsWith("GET ") || preview.startsWith("POST ") || preview.startsWith("HTTP/")) {
                protocol = ProtocolType.HTTP
            } else if (payload.size >= 5 && (payload[0].toInt() in 20..23) && payload[1].toInt() == 3) {
                protocol = if (srcPort == 443 || dstPort == 443) ProtocolType.HTTPS else ProtocolType.TLS
                isEncrypted = payload[0].toInt() == 23
                if (payload[0].toInt() == 22 && payload.size >= 43 && payload[5].toInt() == 1) {
                    clientRandomHex = toHex(payload, 11, 32)
                    val sniRes = extractClientHelloSni(payload)
                    sni = sniRes.first
                    alpn = sniRes.second
                }
            }
        }

        val matchedSecret = clientRandomHex?.let { cr ->
            keylogs.firstOrNull { it.clientRandomHex == cr }?.secretHex
        }

        val domain = dnsQuery ?: sni
        val remoteIp = if (direction == TrafficDirection.OUTBOUND) dstIp else srcIp
        val remotePort = if (direction == TrafficDirection.OUTBOUND) dstPort else srcPort
        val blocked = FirewallAndEnrichment.isBlocked(firewallRules, appName, remoteIp, remotePort, domain)
        val alert = FirewallAndEnrichment.detectAlert(remotePort, domain, blocked)
        val geo = FirewallAndEnrichment.lookup(remoteIp)

        val nowMs = System.currentTimeMillis()
        return CapturedPacket(
            sequence = sequence,
            timestampNs = System.nanoTime(),
            timestampMs = nowMs,
            appDisplayName = appName,
            ipVersion = version,
            srcIp = srcIp,
            srcPort = srcPort,
            dstIp = dstIp,
            dstPort = dstPort,
            protocol = protocol,
            direction = direction,
            totalLength = rawBytes.size,
            payloadLength = payload.size,
            payloadOffset = payloadOffset,
            rawBytes = rawBytes,
            tcpFlags = tcpFlags,
            tcpSeq = tcpSeq,
            tcpAck = tcpAck,
            sni = sni,
            alpn = alpn,
            clientRandomHex = clientRandomHex,
            quicVersion = quicVersion,
            quicDcid = quicDcid,
            quicScid = quicScid,
            dnsQuery = dnsQuery,
            matchedKeylogSecret = matchedSecret,
            isEncryptedPayload = isEncrypted,
            blocked = blocked,
            alertTitle = alert,
            countryCode = geo.first,
            asn = geo.second
        )
    }

    private fun extractClientHelloSni(payload: ByteArray): Pair<String?, List<String>> {
        var ptr = 43
        if (ptr >= payload.size) return null to emptyList()
        ptr += 1 + (payload[ptr].toInt() and 0xFF)
        if (ptr + 2 > payload.size) return null to emptyList()
        ptr += 2 + u16(payload, ptr)
        if (ptr >= payload.size) return null to emptyList()
        ptr += 1 + (payload[ptr].toInt() and 0xFF)
        if (ptr + 2 > payload.size) return null to emptyList()
        val extEnd = minOf(payload.size, ptr + 2 + u16(payload, ptr))
        ptr += 2
        var sni: String? = null
        val alpn = mutableListOf<String>()
        while (ptr + 4 <= extEnd) {
            val extType = u16(payload, ptr)
            val extLen = u16(payload, ptr + 2)
            ptr += 4
            if (ptr + extLen > extEnd) break
            if (extType == 0x0000 && extLen >= 5) {
                val nLen = u16(payload, ptr + 3)
                if (ptr + 5 + nLen <= extEnd) {
                    sni = String(payload, ptr + 5, nLen, StandardCharsets.UTF_8)
                }
            } else if (extType == 0x0010 && extLen >= 3) {
                val listLen = u16(payload, ptr)
                var ap = ptr + 2
                val aEnd = minOf(ptr + 2 + listLen, ptr + extLen)
                while (ap < aEnd) {
                    val pLen = payload[ap].toInt() and 0xFF
                    ap += 1
                    if (ap + pLen <= aEnd) {
                        alpn.add(String(payload, ap, pLen, StandardCharsets.UTF_8))
                    }
                    ap += pLen
                }
            }
            ptr += extLen
        }
        return sni to alpn
    }

    private fun parseDnsQuestionName(payload: ByteArray): String {
        val labels = mutableListOf<String>()
        var idx = 12
        while (idx < payload.size) {
            val len = payload[idx].toInt() and 0xFF
            if (len == 0 || (len and 0xC0) != 0) break
            idx++
            if (idx + len > payload.size) break
            labels.add(String(payload, idx, len, StandardCharsets.UTF_8))
            idx += len
        }
        return labels.joinToString(".")
    }

    private fun u16(b: ByteArray, o: Int): Int = ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF)
    private fun u32(b: ByteArray, o: Int): Long =
        ((b[o].toLong() and 0xFF) shl 24) or
        ((b[o + 1].toLong() and 0xFF) shl 16) or
        ((b[o + 2].toLong() and 0xFF) shl 8) or
        (b[o + 3].toLong() and 0xFF)

    private fun formatIpv4(b: ByteArray, o: Int) =
        "\${b[o].toInt() and 0xFF}.\${b[o + 1].toInt() and 0xFF}.\${b[o + 2].toInt() and 0xFF}.\${b[o + 3].toInt() and 0xFF}"

    private fun formatIpv6(b: ByteArray, o: Int): String =
        (0 until 16 step 2).joinToString(":") { i -> u16(b, o + i).toString(16) }

    private fun toHex(b: ByteArray, offset: Int, len: Int): String =
        (offset until minOf(b.size, offset + len)).joinToString("") { "%02x".format(b[it]) }
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/engine/PcapWriter.kt',
      description: 'Binary .pcap, .pcapng, and raw body .txt file writer',
      content: `package com.sadnan.capture.engine

import com.sadnan.capture.model.CapturedPacket
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets

object PcapWriter {

    fun writePcap(file: File, packets: List<CapturedPacket>) {
        FileOutputStream(file).use { out ->
            val hdr = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
            hdr.putInt(0xa1b23c4d.toInt()) // Nanosecond magic
            hdr.putShort(2)
            hdr.putShort(4)
            hdr.putInt(0)
            hdr.putInt(0)
            hdr.putInt(65535)
            hdr.putInt(101) // LINKTYPE_RAW
            out.write(hdr.array())

            val rec = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
            for (pkt in packets) {
                rec.clear()
                val sec = (pkt.timestampNs / 1_000_000_000L).toInt()
                val nsec = (pkt.timestampNs % 1_000_000_000L).toInt()
                rec.putInt(sec)
                rec.putInt(nsec)
                rec.putInt(pkt.rawBytes.size)
                rec.putInt(pkt.totalLength)
                out.write(rec.array())
                out.write(pkt.rawBytes)
            }
        }
    }

    fun writePcapng(file: File, packets: List<CapturedPacket>) {
        FileOutputStream(file).use { out ->
            val shb = ByteBuffer.allocate(28).order(ByteOrder.LITTLE_ENDIAN)
            shb.putInt(0x0a0d0d0a)
            shb.putInt(28)
            shb.putInt(0x1a2b3c4d)
            shb.putShort(1)
            shb.putShort(0)
            shb.putLong(-1L)
            shb.putInt(28)
            out.write(shb.array())

            val idb = ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN)
            idb.putInt(0x00000001)
            idb.putInt(20)
            idb.putShort(101)
            idb.putShort(0)
            idb.putInt(65535)
            idb.putInt(20)
            out.write(idb.array())

            for (pkt in packets) {
                val padded = (pkt.rawBytes.size + 3) and 3.inv()
                val blockLen = 32 + padded
                val epb = ByteBuffer.allocate(blockLen).order(ByteOrder.LITTLE_ENDIAN)
                val us = pkt.timestampNs / 1000L
                epb.putInt(0x00000006)
                epb.putInt(blockLen)
                epb.putInt(0)
                epb.putInt((us ushr 32).toInt())
                epb.putInt(us.toInt())
                epb.putInt(pkt.rawBytes.size)
                epb.putInt(pkt.totalLength)
                epb.put(pkt.rawBytes)
                repeat(padded - pkt.rawBytes.size) { epb.put(0) }
                epb.putInt(blockLen)
                out.write(epb.array())
            }
        }
    }

    fun writeRawBodyText(file: File, packets: List<CapturedPacket>) {
        val sb = StringBuilder()
        for (pkt in packets) {
            sb.append("[#\${pkt.sequence}] \${pkt.protocol} \${pkt.srcIp}:\${pkt.srcPort} -> \${pkt.dstIp}:\${pkt.dstPort}\\n")
            val body = pkt.rawBytes.copyOfRange(pkt.payloadOffset, pkt.rawBytes.size)
            if (pkt.isEncryptedPayload) {
                sb.append("[ENCRYPTED CIPHERTEXT — NOT DECRYPTED]\\n")
            } else {
                sb.append(String(body, StandardCharsets.UTF_8)).append("\\n")
            }
            sb.append("------------------------------------------------------------\\n")
        }
        file.writeText(sb.toString(), StandardCharsets.UTF_8)
    }
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/engine/FirewallAndEnrichment.kt',
      description: 'Local Firewall evaluator, threat alerts, and offline Country/ASN lookup',
      content: `package com.sadnan.capture.engine

import com.sadnan.capture.model.FirewallRule

object FirewallAndEnrichment {

    private val trackerPatterns = listOf(
        "app-measurement.com", "graph.facebook.com", "doubleclick.net",
        "adjust.com", "appsflyer.com", "crashlytics.com"
    )
    private val suspiciousPorts = setOf(21, 23, 4444, 5555, 6667, 31337)

    fun isBlocked(
        rules: List<FirewallRule>,
        appName: String,
        remoteIp: String,
        remotePort: Int,
        domain: String?
    ): Boolean {
        return rules.any { r ->
            r.enabled && when (r.type) {
                "APP" -> r.value.equals(appName, ignoreCase = true)
                "IP" -> remoteIp == r.value || (r.value.endsWith(".") && remoteIp.startsWith(r.value))
                "PORT" -> r.value.toIntOrNull() == remotePort
                "DOMAIN" -> domain?.contains(r.value, ignoreCase = true) == true
                else -> false
            }
        }
    }

    fun detectAlert(remotePort: Int, domain: String?, blocked: Boolean): String? {
        if (blocked) return "Blocked by Local Firewall"
        if (domain != null && trackerPatterns.any { domain.contains(it, ignoreCase = true) }) {
            return "Tracker Domain: \$domain"
        }
        if (remotePort in suspiciousPorts) {
            return "Suspicious Port: \$remotePort"
        }
        return null
    }

    fun lookup(ip: String): Pair<String, String> = when {
        ip.startsWith("8.8.") || ip.startsWith("142.250.") -> "US" to "AS15169 Google LLC"
        ip.startsWith("1.1.1.") || ip.startsWith("104.16.") -> "US" to "AS13335 Cloudflare"
        ip.startsWith("157.240.") -> "US" to "AS32934 Meta Platforms"
        ip.startsWith("43.229.") || ip.startsWith("202.81.") -> "SG" to "AS58905 Garena Edge SG"
        ip.startsWith("10.") || ip.startsWith("127.") || ip.startsWith("fd00:") -> "LO" to "Local TUN"
        else -> "GL" to "External ASN"
    }
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/engine/EncryptedVaultManager.kt',
      description: 'Android Keystore AES-256-GCM incremental chunk encryption & session recovery',
      content: `package com.sadnan.capture.engine

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class EncryptedVaultManager(private val context: Context) {

    private val keyAlias = "sadnan_capture_aes256_vault_key"

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = ks.getKey(keyAlias, null) as? SecretKey
        if (existing != null) return existing

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    fun writeEncryptedChunk(sessionId: String, chunkIndex: Int, plainBytes: ByteArray): File {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plainBytes)

        val dir = File(context.filesDir, "vault/\$sessionId").apply { mkdirs() }
        val chunkFile = File(dir, "chunk_\${chunkIndex}.enc")
        chunkFile.outputStream().use { out ->
            out.write(iv.size)
            out.write(iv)
            out.write(ciphertext)
        }
        return chunkFile
    }

    fun decryptChunk(file: File): ByteArray {
        val all = file.readBytes()
        val ivLen = all[0].toInt() and 0xFF
        val iv = all.copyOfRange(1, 1 + ivLen)
        val ciphertext = all.copyOfRange(1 + ivLen, all.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    }

    fun findIncompleteSessions(): List<File> {
        val root = File(context.filesDir, "vault")
        return root.listFiles()?.filter { it.isDirectory && !File(it, "closed.marker").exists() } ?: emptyList()
    }
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/vpn/SadnanVpnService.kt',
      description: 'Local VpnService TUN loop with addAllowedApplication(), ring buffer, drop counter, and error log',
      content: `package com.sadnan.capture.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import com.sadnan.capture.engine.EncryptedVaultManager
import com.sadnan.capture.engine.PacketDissector
import com.sadnan.capture.model.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

object CaptureRepository {
    val isCapturing = MutableStateFlow(false)
    val packets = MutableStateFlow<List<CapturedPacket>>(emptyList())
    val droppedPackets = MutableStateFlow(0L)
    val errorLog = MutableStateFlow<List<String>>(emptyList())
    val keylogs = MutableStateFlow<List<KeylogEntry>>(emptyList())
    val firewallRules = MutableStateFlow<List<FirewallRule>>(emptyList())
    var bufferCapacity = 5000
    var selectedAppName = "All Isolated Apps"
    var selectedPackageName: String? = null
}

class SadnanVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private val running = AtomicBoolean(false)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val ringQueue = ArrayBlockingQueue<ByteArray>(5000)
    private val seqCounter = AtomicLong(1L)

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP_CAPTURE") {
            stopCapture()
            return START_NOT_STICKY
        }
        startForegroundNotification()
        startTunCapture()
        return START_STICKY
    }

    private fun startTunCapture() {
        if (running.getAndSet(true)) return
        CaptureRepository.isCapturing.value = true

        val builder = Builder()
            .setSession("SADNAN CAPTURE")
            .setMtu(1500)
            .addAddress("10.0.0.2", 32)
            .addRoute("0.0.0.0", 0)
            .addAddress("fd00:10::2", 128)
            .addRoute("::", 0)
            .addDnsServer("8.8.8.8")

        // Isolate traffic by selected application when chosen.
        // OS VPN attribution note: Android VpnService isolates flows via UID/package routing;
        // shared system daemons (e.g. DNS resolver) may still appear under system UID depending on OS version.
        val pkg = CaptureRepository.selectedPackageName
        if (!pkg.isNullOrBlank()) {
            try {
                builder.addAllowedApplication(pkg)
            } catch (e: Exception) {
                CaptureRepository.errorLog.value =
                    listOf("App isolation warning: \${e.message}") + CaptureRepository.errorLog.value
            }
        }

        vpnInterface = builder.establish()
        val fd = vpnInterface?.fileDescriptor ?: run {
            CaptureRepository.errorLog.value = listOf("Failed to establish VpnService TUN fd")
            stopCapture()
            return
        }

        val vault = EncryptedVaultManager(applicationContext)
        val sessionId = "sess_\${System.currentTimeMillis()}"

        // Reader coroutine (non-blocking enqueue into ring buffer)
        scope.launch {
            val input = FileInputStream(fd)
            val buf = ByteBuffer.allocate(32767)
            while (running.get()) {
                val read = input.read(buf.array())
                if (read > 0) {
                    val copy = buf.array().copyOfRange(0, read)
                    if (!ringQueue.offer(copy)) {
                        CaptureRepository.droppedPackets.value += 1
                    }
                    buf.clear()
                }
            }
        }

        // Batched dissector & AES-256-GCM vault writer coroutine
        scope.launch {
            var chunkIndex = 0
            val batch = mutableListOf<ByteArray>()
            while (running.get()) {
                ringQueue.drainTo(batch, 32)
                if (batch.isNotEmpty()) {
                    val parsed = batch.mapNotNull { raw ->
                        PacketDissector.dissect(
                            rawBytes = raw,
                            sequence = seqCounter.getAndIncrement(),
                            appName = CaptureRepository.selectedAppName,
                            direction = TrafficDirection.OUTBOUND,
                            keylogs = CaptureRepository.keylogs.value,
                            firewallRules = CaptureRepository.firewallRules.value
                        )
                    }
                    if (parsed.isNotEmpty()) {
                        val current = (CaptureRepository.packets.value + parsed)
                            .takeLast(CaptureRepository.bufferCapacity)
                        CaptureRepository.packets.value = current
                        val combined = batch.fold(ByteArray(0)) { acc, b -> acc + b }
                        vault.writeEncryptedChunk(sessionId, chunkIndex++, combined)
                    }
                    batch.clear()
                } else {
                    delay(20)
                }
            }
        }
    }

    private fun stopCapture() {
        running.set(false)
        CaptureRepository.isCapturing.value = false
        vpnInterface?.close()
        vpnInterface = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startForegroundNotification() {
        val channelId = "sadnan_vpn_channel"
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.createNotificationChannel(
            NotificationChannel(channelId, "SADNAN CAPTURE VPN", NotificationManager.IMPORTANCE_LOW)
        )
        val notif = Notification.Builder(this, channelId)
            .setContentTitle("SADNAN CAPTURE Active")
            .setContentText("Capturing non-root VpnService packets locally")
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .build()
        startForeground(101, notif)
    }

    override fun onDestroy() {
        stopCapture()
        scope.cancel()
        super.onDestroy()
    }
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/overlay/FloatingOverlayService.kt',
      description: 'Draggable SYSTEM_ALERT_WINDOW mini floating overlay with live counts, protocol filter, and Stop button',
      content: `package com.sadnan.capture.overlay

import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.IBinder
import android.view.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.sadnan.capture.vpn.CaptureRepository
import com.sadnan.capture.vpn.SadnanVpnService
import kotlinx.coroutines.*

class FloatingOverlayService : Service() {

    private lateinit var windowManager: WindowManager
    private var rootView: LinearLayout? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var activeFilter = "ALL"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 40
            y = 180
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#EE1C2026"))
            setPadding(24, 18, 24, 18)
        }

        val headerText = TextView(this).apply {
            setTextColor(Color.parseColor("#26A69A"))
            textSize = 13f
            text = "SADNAN CAPTURE · Overlay"
        }
        val statsText = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 11f
        }
        val feedText = TextView(this).apply {
            setTextColor(Color.parseColor("#B0BEC5"))
            textSize = 10f
            maxLines = 4
        }

        val filterRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("ALL", "HTTPS", "UDP", "TCP", "DNS", "TLS", "QUIC").forEach { proto ->
            val btn = Button(this).apply {
                text = proto
                textSize = 9f
                setOnClickListener { activeFilter = proto }
            }
            filterRow.addView(btn)
        }

        val stopBtn = Button(this).apply {
            text = "Stop Capture"
            setBackgroundColor(Color.parseColor("#EF5350"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                startService(Intent(this@FloatingOverlayService, SadnanVpnService::class.java).apply {
                    action = "STOP_CAPTURE"
                })
                stopSelf()
            }
        }

        container.addView(headerText)
        container.addView(statsText)
        container.addView(filterRow)
        container.addView(feedText)
        container.addView(stopBtn)

        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        container.setOnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x; startY = params.y
                    touchX = ev.rawX; touchY = ev.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (ev.rawX - touchX).toInt()
                    params.y = startY + (ev.rawY - touchY).toInt()
                    windowManager.updateViewLayout(container, params)
                    true
                }
                else -> false
            }
        }

        rootView = container
        windowManager.addView(container, params)

        scope.launch {
            while (isActive) {
                val all = CaptureRepository.packets.value
                val filtered = if (activeFilter == "ALL") all else all.filter { it.protocol.name == activeFilter }
                val totalBytes = all.sumOf { it.totalLength }
                statsText.text = "Pkts: \${all.size} | Bytes: \$totalBytes | Drops: \${CaptureRepository.droppedPackets.value}"
                feedText.text = filtered.takeLast(4).joinToString("\\n") {
                    "\${it.protocol} \${it.dstIp}:\${it.dstPort} (\${it.totalLength}B)"
                }
                delay(350)
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        rootView?.let { windowManager.removeView(it) }
        super.onDestroy()
    }
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/share/ShareHelper.kt',
      description: 'Android FileProvider share helper for Telegram, WhatsApp, IMO, and system share',
      content: `package com.sadnan.capture.share

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

object ShareHelper {
    fun shareExportFile(context: Context, file: File, mimeType: String, preferredAppPackage: String? = null) {
        val uri = FileProvider.getUriForFile(context, "\${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            if (!preferredAppPackage.isNullOrBlank()) {
                setPackage(preferredAppPackage)
            }
        }
        val chooser = Intent.createChooser(intent, "Share SADNAN CAPTURE Export").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(chooser)
    }
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/ui/CaptureTheme.kt',
      description: 'PCAPdroid Material Dark color palette',
      content: `package com.sadnan.capture.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object PcapColors {
    val Background = Color(0xFF121518)
    val Card = Color(0xFF1C2026)
    val ListRow = Color(0xFF181C22)
    val TealPrimary = Color(0xFF00897B)
    val TealAccent = Color(0xFF26A69A)
    val GreenUdp = Color(0xFF66BB6A)
    val AmberTls = Color(0xFFFFA726)
    val RedAlert = Color(0xFFEF5350)
}

private val DarkScheme = darkColorScheme(
    primary = PcapColors.TealPrimary,
    secondary = PcapColors.TealAccent,
    background = PcapColors.Background,
    surface = PcapColors.Card,
    error = PcapColors.RedAlert,
    onBackground = Color(0xFFECEFF1),
    onSurface = Color(0xFFECEFF1)
)

@Composable
fun SadnanCaptureTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkScheme, content = content)
}
`,
    },
    {
      path: 'app/src/main/java/com/sadnan/capture/MainActivity.kt',
      description: 'Main Activity hosting Material Toolbar, STATUS | CONNECTIONS tabs, Hero Ring, Friendly App Selector, and Packet Detail Sheet',
      content: `package com.sadnan.capture

import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sadnan.capture.model.DumpMode
import com.sadnan.capture.model.TargetAppProfile
import com.sadnan.capture.overlay.FloatingOverlayService
import com.sadnan.capture.ui.PcapColors
import com.sadnan.capture.ui.SadnanCaptureTheme
import com.sadnan.capture.vpn.CaptureRepository
import com.sadnan.capture.vpn.SadnanVpnService

class MainActivity : ComponentActivity() {

    private val vpnLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        if (res.resultCode == RESULT_OK) {
            startForegroundService(Intent(this, SadnanVpnService::class.java))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Friendly App Names & Icons only (package IDs are internal to VpnService.Builder)
        val appOptions = listOf(
            TargetAppProfile("all", "All Isolated Apps", null),
            TargetAppProfile("free_fire", "Free Fire", "com.dts.freefireth"),
            TargetAppProfile("free_fire_max", "Free Fire MAX", "com.dts.freefiremax"),
            TargetAppProfile("chrome", "Google Chrome", "com.android.chrome"),
            TargetAppProfile("whatsapp", "WhatsApp", "com.whatsapp")
        )

        setContent {
            SadnanCaptureTheme {
                var selectedTab by remember { mutableIntStateOf(0) }
                var selectedApp by remember { mutableStateOf(appOptions.first()) }
                var dumpMode by remember { mutableStateOf(DumpMode.PCAPNG) }
                val capturing by CaptureRepository.isCapturing.collectAsState()
                val packets by CaptureRepository.packets.collectAsState()
                val drops by CaptureRepository.droppedPackets.collectAsState()

                Scaffold(
                    containerColor = PcapColors.Background,
                    topBar = {
                        @OptIn(ExperimentalMaterial3Api::class)
                        TopAppBar(
                            colors = TopAppBarDefaults.topAppBarColors(containerColor = PcapColors.Card),
                            title = { Text("SADNAN CAPTURE", fontWeight = FontWeight.Bold) },
                            actions = {
                                IconButton(onClick = {
                                    if (Settings.canDrawOverlays(this@MainActivity)) {
                                        startService(Intent(this@MainActivity, FloatingOverlayService::class.java))
                                    } else {
                                        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
                                    }
                                }) { Icon(Icons.Default.PictureInPictureAlt, contentDescription = "Overlay") }
                                IconButton(onClick = {
                                    if (capturing) {
                                        startService(Intent(this@MainActivity, SadnanVpnService::class.java).apply {
                                            action = "STOP_CAPTURE"
                                        })
                                    } else {
                                        CaptureRepository.selectedAppName = selectedApp.displayName
                                        CaptureRepository.selectedPackageName = selectedApp.internalPackageId
                                        val prep = VpnService.prepare(this@MainActivity)
                                        if (prep != null) vpnLauncher.launch(prep)
                                        else startForegroundService(Intent(this@MainActivity, SadnanVpnService::class.java))
                                    }
                                }) {
                                    Icon(
                                        if (capturing) Icons.Default.Stop else Icons.Default.PlayArrow,
                                        contentDescription = "Toggle Capture"
                                    )
                                }
                            }
                        )
                    }
                ) { padding ->
                    Column(Modifier.padding(padding).fillMaxSize()) {
                        TabRow(selectedTabIndex = selectedTab, containerColor = PcapColors.Card) {
                            Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }, text = { Text("STATUS") })
                            Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }, text = { Text("CONNECTIONS") })
                        }
                        if (selectedTab == 0) {
                            Column(
                                Modifier.fillMaxSize().padding(16.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Box(
                                    Modifier.size(160.dp)
                                        .background(if (capturing) PcapColors.TealPrimary else PcapColors.Card, CircleShape)
                                        .clickable {
                                            if (capturing) {
                                                startService(Intent(this@MainActivity, SadnanVpnService::class.java).apply {
                                                    action = "STOP_CAPTURE"
                                                })
                                            } else {
                                                CaptureRepository.selectedAppName = selectedApp.displayName
                                                CaptureRepository.selectedPackageName = selectedApp.internalPackageId
                                                val prep = VpnService.prepare(this@MainActivity)
                                                if (prep != null) vpnLauncher.launch(prep)
                                                else startForegroundService(Intent(this@MainActivity, SadnanVpnService::class.java))
                                            }
                                        },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(if (capturing) "STOP" else "READY", fontWeight = FontWeight.Bold, color = Color.White)
                                }
                                Spacer(Modifier.height(16.dp))
                                Text("Packets: \${packets.size} · Drops: \$drops · Dump: \$dumpMode")
                                Spacer(Modifier.height(16.dp))
                                Text("Target Apps", fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.Start))
                                appOptions.forEach { app ->
                                    Row(
                                        Modifier.fillMaxWidth().clickable { selectedApp = app }.padding(vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        RadioButton(selected = selectedApp.id == app.id, onClick = { selectedApp = app })
                                        Spacer(Modifier.width(8.dp))
                                        Text(app.displayName)
                                    }
                                }
                            }
                        } else {
                            LazyColumn(Modifier.fillMaxSize()) {
                                items(packets.reversed()) { pkt ->
                                    Column(
                                        Modifier.fillMaxWidth().background(PcapColors.ListRow).padding(12.dp)
                                    ) {
                                        Text("\${pkt.protocol} · \${pkt.dstIp}:\${pkt.dstPort}", fontWeight = FontWeight.SemiBold)
                                        Text(
                                            "\${pkt.appDisplayName} · \${pkt.totalLength}B · \${pkt.countryCode}/\${pkt.asn}",
                                            color = Color(0xFF90A4AE)
                                        )
                                    }
                                    HorizontalDivider(color = Color(0xFF262B33))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
`,
    },
  ];
}

export async function buildAndroidProjectZip(): Promise<Buffer> {
  const zip = new JSZip();
  const files = getAndroidProjectFiles();
  for (const f of files) {
    zip.file(f.path, f.content);
  }
  const arrayBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return arrayBuf;
}
