package expo.modules.tahaknearby

import android.content.Context
import android.util.Log
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import com.google.android.gms.tasks.Task
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "TahakNearby"

/**
 * Google Nearby Connections for the Group Hike (issue #23): phones find and link each other
 * over Bluetooth and Wi-Fi with no internet (ADR 0002).
 *
 * Strategy P2P_CLUSTER (M-to-N). The transport in JS (src/modules/alerts/nearbyTransport.ts)
 * decides who advertises, who discovers, which connection to accept and what to send; this
 * module only moves bytes and reports what happened:
 *
 * - advertising and discovery under one service id;
 * - requesting, accepting and rejecting connections;
 * - BYTES payloads. JS hands over a UTF-8 string, it travels as bytes, and the receiver gets
 *   the same string back in an onPayload event. Larger than MAX_BYTES_DATA_SIZE is refused;
 * - events to JS for every endpoint and connection change.
 *
 * Nearby needs Bluetooth, Wi-Fi and (by API level) location or nearby-devices permissions,
 * granted at runtime before advertising or discovery start. This module neither declares nor
 * asks for them: the app's config and the Group Hike UI do (#23 Phase 2). Without them the
 * start calls reject with Nearby's status code, and nothing crashes.
 *
 * Every step is logged under the "TahakNearby" tag, for logcat.
 */
class TahakNearbyModule : Module() {
  private val context: Context?
    get() = appContext.reactContext

  private val client: ConnectionsClient?
    get() = context?.let { Nearby.getConnectionsClient(it) }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      if (payload.type != Payload.Type.BYTES) {
        Log.w(TAG, "ignored non-bytes payload from $endpointId")
        return
      }
      val bytes = payload.asBytes() ?: return
      sendEvent(
        "onPayload",
        mapOf("endpointId" to endpointId, "text" to String(bytes, Charsets.UTF_8)),
      )
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
      // BYTES payloads arrive whole in onPayloadReceived; nothing to track here.
    }
  }

  private val connectionCallback = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      Log.i(TAG, "connection initiated with $endpointId (${info.endpointName}), incoming=${info.isIncomingConnection}")
      sendEvent(
        "onConnectionInitiated",
        mapOf(
          "endpointId" to endpointId,
          "endpointName" to info.endpointName,
          "incoming" to info.isIncomingConnection,
        ),
      )
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      val code = result.status.statusCode
      val status = when (code) {
        ConnectionsStatusCodes.STATUS_OK -> "connected"
        ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED -> "rejected"
        else -> "error"
      }
      Log.i(TAG, "connection result with $endpointId: $status ($code)")
      sendEvent(
        "onConnectionResult",
        mapOf("endpointId" to endpointId, "status" to status, "statusCode" to code),
      )
    }

    override fun onDisconnected(endpointId: String) {
      Log.i(TAG, "disconnected from $endpointId")
      sendEvent("onDisconnected", mapOf("endpointId" to endpointId))
    }
  }

  private val discoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      Log.i(TAG, "found $endpointId (${info.endpointName})")
      sendEvent(
        "onEndpointFound",
        mapOf("endpointId" to endpointId, "endpointName" to info.endpointName, "serviceId" to info.serviceId),
      )
    }

    override fun onEndpointLost(endpointId: String) {
      Log.i(TAG, "lost $endpointId")
      sendEvent("onEndpointLost", mapOf("endpointId" to endpointId))
    }
  }

  /** Resolves the promise when the task succeeds; rejects it with Nearby's status code otherwise. */
  private fun settle(task: Task<Void>, promise: Promise, what: String) {
    task
      .addOnSuccessListener {
        Log.i(TAG, "$what ok")
        promise.resolve(null)
      }
      .addOnFailureListener { e ->
        val code = (e as? ApiException)?.statusCode
        Log.w(TAG, "$what failed (${code ?: "?"}): ${e.message}")
        promise.reject("ERR_NEARBY_${code ?: "UNKNOWN"}", "$what failed: ${e.message}", e)
      }
  }

  private fun noClient(promise: Promise) {
    promise.reject("ERR_NEARBY_NO_CONTEXT", "No Android context for Nearby Connections", null)
  }

  private fun stopEverything() {
    client?.let {
      it.stopAdvertising()
      it.stopDiscovery()
      it.stopAllEndpoints()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("TahakNearby")

    Events(
      "onEndpointFound",
      "onEndpointLost",
      "onConnectionInitiated",
      "onConnectionResult",
      "onDisconnected",
      "onPayload",
    )

    /** The largest BYTES payload Nearby carries, in bytes. */
    Constant("maxBytes") {
      ConnectionsClient.MAX_BYTES_DATA_SIZE
    }

    /** Advertises this phone under endpointName so others discovering serviceId can find it. */
    AsyncFunction("startAdvertising") { endpointName: String, serviceId: String, promise: Promise ->
      val c = client ?: return@AsyncFunction noClient(promise)
      val options = AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build()
      settle(c.startAdvertising(endpointName, serviceId, connectionCallback, options), promise, "advertising as $endpointName")
    }

    Function("stopAdvertising") {
      client?.stopAdvertising()
      Log.i(TAG, "advertising stopped")
      Unit
    }

    /** Looks for phones advertising serviceId; each one found is an onEndpointFound event. */
    AsyncFunction("startDiscovery") { serviceId: String, promise: Promise ->
      val c = client ?: return@AsyncFunction noClient(promise)
      val options = DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build()
      settle(c.startDiscovery(serviceId, discoveryCallback, options), promise, "discovery")
    }

    Function("stopDiscovery") {
      client?.stopDiscovery()
      Log.i(TAG, "discovery stopped")
      Unit
    }

    /** Asks a found endpoint to connect; both sides then get onConnectionInitiated. */
    AsyncFunction("requestConnection") { localName: String, endpointId: String, promise: Promise ->
      val c = client ?: return@AsyncFunction noClient(promise)
      settle(c.requestConnection(localName, endpointId, connectionCallback), promise, "request connection to $endpointId")
    }

    AsyncFunction("acceptConnection") { endpointId: String, promise: Promise ->
      val c = client ?: return@AsyncFunction noClient(promise)
      settle(c.acceptConnection(endpointId, payloadCallback), promise, "accept $endpointId")
    }

    AsyncFunction("rejectConnection") { endpointId: String, promise: Promise ->
      val c = client ?: return@AsyncFunction noClient(promise)
      settle(c.rejectConnection(endpointId), promise, "reject $endpointId")
    }

    /** Sends text as one BYTES payload (UTF-8) to each connected endpoint in endpointIds. */
    AsyncFunction("sendBytes") { endpointIds: List<String>, text: String, promise: Promise ->
      val c = client ?: return@AsyncFunction noClient(promise)
      if (endpointIds.isEmpty()) return@AsyncFunction promise.resolve(null)
      val bytes = text.toByteArray(Charsets.UTF_8)
      if (bytes.size > ConnectionsClient.MAX_BYTES_DATA_SIZE) {
        return@AsyncFunction promise.reject("ERR_NEARBY_TOO_LARGE", "Payload of ${bytes.size} bytes is too large", null)
      }
      settle(c.sendPayload(endpointIds, Payload.fromBytes(bytes)), promise, "send ${bytes.size} bytes")
    }

    Function("disconnect") { endpointId: String ->
      client?.disconnectFromEndpoint(endpointId)
      Log.i(TAG, "disconnect $endpointId")
      Unit
    }

    /** Stops advertising and discovery and drops every connection. */
    Function("stopAll") {
      stopEverything()
      Log.i(TAG, "stopped all")
      Unit
    }

    OnDestroy {
      stopEverything()
    }
  }
}
