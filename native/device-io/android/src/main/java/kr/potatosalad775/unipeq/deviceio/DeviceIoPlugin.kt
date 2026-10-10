package kr.potatosalad775.unipeq.deviceio

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * uniPEQ device I/O (ARCHITECTURE.md §9). USB HID only so far.
 *
 * Bytes cross the JS bridge as base64. Events: `inputReport` {handle, data},
 * `deviceAttached` {device}, `deviceDetached` {deviceName}. Failures reject with code
 * `transport`, which the TS wrapper maps to a bridge `BridgeError('transport')`.
 */
@CapacitorPlugin(name = "DeviceIo")
class DeviceIoPlugin : Plugin() {
    private val usb by lazy { context.getSystemService(Context.USB_SERVICE) as UsbManager }
    private val connections = ConcurrentHashMap<Int, UsbHidConnection>()
    private val nextHandle = AtomicInteger(1)
    private val permissionCalls = ConcurrentHashMap<String, MutableList<PluginCall>>()

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val device = IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                ?: return
            when (intent.action) {
                ACTION_USB_PERMISSION -> {
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    permissionCalls.remove(device.deviceName)?.forEach {
                        it.resolve(JSObject().put("granted", granted))
                    }
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> notifyListeners("deviceAttached", JSObject().put("device", info(device)))
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    connections.entries.filter { it.value.device.deviceName == device.deviceName }.forEach {
                        connections.remove(it.key)
                        runCatching { it.value.close() }
                    }
                    notifyListeners("deviceDetached", JSObject().put("deviceName", device.deviceName))
                }
            }
        }
    }

    override fun load() {
        val filter = IntentFilter().apply {
            addAction(ACTION_USB_PERMISSION)
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun handleOnDestroy() {
        runCatching { context.unregisterReceiver(receiver) }
        connections.values.forEach { runCatching { it.close() } }
        connections.clear()
    }

    /** Every attached USB device with at least one HID interface. */
    @PluginMethod
    fun list(call: PluginCall) {
        val devices = JSArray()
        usb.deviceList.values.filter { UsbHidConnection.hidInterfaces(it).isNotEmpty() }.forEach { devices.put(info(it)) }
        call.resolve(JSObject().put("devices", devices))
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val device = findDevice(call) ?: return
        if (usb.hasPermission(device)) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        permissionCalls.getOrPut(device.deviceName) { mutableListOf() }.add(call)
        val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        usb.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
    }

    /**
     * Report descriptors of the device's HID interfaces. Claims each one with force (detaching the
     * kernel HID driver until the device is replugged), reads it and releases it again.
     */
    @PluginMethod
    fun describe(call: PluginCall) {
        val device = findDevice(call) ?: return
        val connection = usb.openDevice(device) ?: return call.reject("openDevice failed (no permission?)", ERROR)
        val interfaces = JSArray()
        try {
            for (iface in UsbHidConnection.hidInterfaces(device)) {
                val claimed = connection.claimInterface(iface, true)
                val descriptor = if (claimed) UsbHidConnection.readReportDescriptor(connection, iface) else null
                if (claimed) connection.releaseInterface(iface)
                interfaces.put(JSObject().apply {
                    put("number", iface.id)
                    put("claimed", claimed)
                    put("endpoints", iface.endpointCount)
                    if (descriptor != null) put("reportDescriptor", encode(descriptor))
                })
            }
        } finally {
            connection.close()
        }
        call.resolve(JSObject().put("interfaces", interfaces))
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val device = findDevice(call) ?: return
        val number = call.getInt("interfaceNumber") ?: return call.reject("interfaceNumber is required", ERROR)
        val iface = UsbHidConnection.hidInterfaces(device).firstOrNull { it.id == number }
            ?: return call.reject("No HID interface $number", ERROR)
        val connection = usb.openDevice(device) ?: return call.reject("openDevice failed (no permission?)", ERROR)
        if (!connection.claimInterface(iface, true)) {
            connection.close()
            return call.reject("claimInterface($number, force) failed", ERROR)
        }
        val handle = nextHandle.getAndIncrement()
        val hid = UsbHidConnection(device, connection, iface) { bytes ->
            notifyListeners("inputReport", JSObject().put("handle", handle).put("data", encode(bytes)))
        }
        connections[handle] = hid
        call.resolve(JSObject().apply {
            put("handle", handle)
            put("inputEndpoint", hid.inEndpoint != null)
            put("outputEndpoint", hid.outEndpoint != null)
        })
    }

    @PluginMethod
    fun sendReport(call: PluginCall) = io(call) { hid ->
        hid.sendReport(call.getInt("reportId") ?: 0, decode(call.getString("data")))
        null
    }

    @PluginMethod
    fun sendFeatureReport(call: PluginCall) = io(call) { hid ->
        hid.sendFeatureReport(call.getInt("reportId") ?: 0, decode(call.getString("data")))
        null
    }

    @PluginMethod
    fun receiveFeatureReport(call: PluginCall) = io(call) { hid ->
        val data = hid.receiveFeatureReport(call.getInt("reportId") ?: 0, call.getInt("length") ?: 64)
        JSObject().put("data", encode(data))
    }

    @PluginMethod
    fun close(call: PluginCall) {
        call.getInt("handle")?.let { connections.remove(it) }?.let { runCatching { it.close() } }
        call.resolve()
    }

    private fun io(call: PluginCall, block: (UsbHidConnection) -> JSObject?) {
        val hid = call.getInt("handle")?.let { connections[it] }
            ?: return call.reject("Not open (closed or detached)", ERROR)
        try {
            val result = block(hid)
            if (result != null) call.resolve(result) else call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: e.toString(), ERROR, e)
        }
    }

    private fun findDevice(call: PluginCall): UsbDevice? {
        val name = call.getString("deviceName")
        val device = usb.deviceList[name]
        if (device == null) call.reject("No USB device $name", ERROR)
        return device
    }

    private fun info(d: UsbDevice) = JSObject().apply {
        put("deviceName", d.deviceName)
        put("vendorId", d.vendorId)
        put("productId", d.productId)
        put("productName", d.productName ?: "")
        put("manufacturerName", d.manufacturerName ?: "")
        put("hasPermission", usb.hasPermission(d))
        put("hidInterfaces", JSArray().also { a -> UsbHidConnection.hidInterfaces(d).forEach { a.put(it.id) } })
    }

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun decode(data: String?) = if (data.isNullOrEmpty()) ByteArray(0) else Base64.decode(data, Base64.DEFAULT)

    companion object {
        private const val ACTION_USB_PERMISSION = "kr.potatosalad775.unipeq.USB_PERMISSION"
        private const val ERROR = "transport"
    }
}
